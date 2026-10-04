// Отбор вакансий для отклика целиком в коде.
//
// Зачем он нужен. Партии 1 и 2 отбирались глазами: заголовок плюс несколько
// собранных предложений. Аудит потом нашёл в этой ручной работе 24 вакансии с
// пунктом, который закрыть нельзя, — пять из них стояли в первых семнадцати
// местах очереди. Слова «коммерческий опыт», «от 3 лет», «высшее образование»
// невозможно заметить глазами надёжно: их надо искать правилом по описанию.
//
// Здесь всё то же самое, но автоматически и воспроизводимо:
//   1. поиск hh по QUERIES из hh-search.js, удалённая работа, вся Россия;
//   2. уровень опыта берётся из карточки поиска, а не из заголовка;
//      берём «не требуется» и «1–3 года», остальное — не джун;
//   3. заголовок и компания проверяются правилами hh-target.js;
//   4. описание вакансии проверяется правилом опыта hh-experience.js;
//   5. отсеиваются уже отправленные, уже отобранные и отклонённые;
//   6. остаток дедуплицируется по компании и заголовку.
//
// Результат: hh-candidates.json — вакансии, которые уже можно добавлять
// в очередь без ручного чтения описаний.
//
// Почему поиск идёт из node, а не из страницы. Описания hh отдаёт гостю без
// cookies, и для отбора cookies не нужны. А node даёт то, чего не даёт страница:
// один и тот же код отбора и проверки работает и вручную, и в аудите, и в
// тестах, без расхождений между копиями.
const fs = require('fs');
const path = require('path');
const { QUERIES, SEARCH_BASE } = require('./hh-search.js');
const { judge } = require('./hh-target.js');
const { reasonIn, MONTH_THRESHOLD } = require('./hh-experience.js');
const shortlist = require('./hh-shortlist.js');
const drop = require('./hh-shortlist-drop.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const SEARCH_PAGES = 4;
const CONCURRENCY = 2;
const PAUSE_MS = 700;
const RETRY_PAUSES = [2500, 6000, 15000];
const OUT = 'hh-candidates.json';

// Уровень опыта из карточки поиска. «1–3 года» — реалистичный потолок для
// человека без коммерческого стажа; в удалённой выдаче hh вакансий «опыт не
// требуется» нет вообще, это проверено на 1653 карточках.
const EXP_OK = ['noExperience', 'between1And3'];

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&quot;/g, '"'], [/&#39;/g, "'"],
  [/&laquo;/g, '«'], [/&raquo;/g, '»'], [/&mdash;/g, '—'], [/&ndash;/g, '–'],
  [/&lt;/g, '<'], [/&gt;/g, '>'],
];

function htmlToText(html) {
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|li|div|h[1-6]|tr|span)>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function descriptionOf(html) {
  const open = html.indexOf('data-qa="vacancy-description"');
  if (open < 0) return '';
  const start = html.indexOf('>', open);
  if (start < 0) return '';
  const close = html.indexOf('data-qa="vacancy-description-next"', start);
  const slice = html.slice(start, close > 0 ? close : Math.min(html.length, start + 60000));
  return htmlToText(slice);
}

// Файл отправленных — одна строка через запятую. Разбивать надо по запятой:
// первая версия резала по пробелам, возвращала пустой массив, и все 127 уже
// отправленных вакансий выглядели как новые. Молчаливый пустой список опаснее
// ошибки: он не ломает отбор, а просто возвращает в очередь то, что уже отправлено.
function readApplied(file) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return [];
  const raw = fs.readFileSync(full, 'utf8');
  const ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  if (raw.trim() && ids.length === 0) {
    throw new Error(file + ' не пуст, но ни один id не разобрался — формат файла изменился, дальше не идём');
  }
  return ids;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Карточки из HTML выдачи. Разбор строковый, а не через DOM: в node нет DOM,
// а приводить страницу к DOM ради двадцати селекторов дорого и хрупко.
function cardsOf(html) {
  const out = [];
  const chunks = html.split('data-qa="vacancy-serp__vacancy"').slice(1);
  for (const chunk of chunks) {
    const idm = chunk.match(/vacancy\/(\d+)/);
    if (!idm) continue;
    const body = chunk.slice(0, 4000);
    const titleM = body.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,200}?)<\/a>/);
    const coM = body.match(/data-qa="vacancy-serp__vacancy-employer-text"[^>]*>([\s\S]{0,200}?)<\/a>/);
    const expM = body.match(/work-experience-([A-Za-z0-9]+)/);
    out.push({
      id: idm[1],
      title: titleM ? htmlToText(titleM[1]) : '',
      co: coM ? htmlToText(coM[1]) : '',
      exp: expM ? expM[1] : '',
      remote: /vacancy-label-work-schedule-remote/.test(body),
    });
  }
  return out;
}

async function fetchText(url, idForError) {
  let last = 0;
  for (let attempt = 0; attempt <= RETRY_PAUSES.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_PAUSES[attempt - 1]);
    const host = HOSTS[attempt % HOSTS.length];
    try {
      const r = await fetch(host + url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      last = r.status;
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch (e) {
      last = 0;
    }
  }
  throw new Error(idForError + ': не отдали страницу (последний статус ' + last + ')');
}

async function main() {
  const applied = readApplied('hh-applied-ids.txt');
  console.log('уже отправлено: ' + applied.length + ' id, разобрано ранее: ' + shortlist.length + ' в шорт-листе, ' + drop.length + ' в отсеве');
  const known = new Set(shortlist.map((v) => v.id).concat(drop.map((d) => d.id), applied));

  // Шаг 1: собрать выдачу.
  const seen = new Map();
  const seenPages = [];
  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    let pages = 0;
    for (let page = 0; page < SEARCH_PAGES; page++) {
      let html;
      try {
        html = await fetchText(SEARCH_BASE + encodeURIComponent(q) + '&page=' + page, q + ' стр. ' + page);
      } catch (e) {
        console.log('  пропущен запрос: ' + e.message);
        break;
      }
      const cards = cardsOf(html);
      if (!cards.length) break;
      pages++;
      for (const c of cards) if (!seen.has(c.id)) seen.set(c.id, c);
      await sleep(PAUSE_MS);
    }
    seenPages.push(pages);
  }
  console.log('запросов: ' + QUERIES.length + ', страниц отдано: ' + seenPages.reduce((a, b) => a + b, 0) + ', карточек: ' + seen.size);

  // Шаг 2: заголовок, компания, уровень опыта.
  const byReason = {};
  const step2 = [];
  for (const v of seen.values()) {
    if (EXP_OK.indexOf(v.exp) < 0) { byReason['опыт: ' + (v.exp || 'не указан')] = (byReason['опыт: ' + (v.exp || 'не указан')] || 0) + 1; continue; }
    if (!v.remote) { byReason['не удалённая'] = (byReason['не удалённая'] || 0) + 1; continue; }
    if (known.has(v.id)) { byReason['уже отправлено или разобрано'] = (byReason['уже отправлено или разобрано'] || 0) + 1; continue; }
    const j = judge({ title: v.title, company: v.co });
    if (!j.ok) { byReason[j.reason] = (byReason[j.reason] || 0) + 1; continue; }
    step2.push(v);
  }
  console.log('после заголовков и опыта: ' + step2.length + ', отсеяно по причинам: ' + JSON.stringify(byReason));

  // Шаг 3: описание и правило опыта.
  const survivors = [];
  const rejected = [];
  const unreadable = [];
  let cursor = 0;
  async function worker() {
    while (cursor < step2.length) {
      const v = step2[cursor++];
      try {
        const html = await fetchText('/vacancy/' + v.id, v.id);
        const desc = descriptionOf(html);
        if (!desc) { unreadable.push(v.id); continue; }
        const hasApply = /data-qa="vacancy-response-link-top"/.test(html);
        if (!hasApply) { rejected.push({ v: v, rule: 'closed' }); continue; }
        const why = reasonIn(desc);
        if (why) { rejected.push({ v: v, rule: why.rule, matched: why.matched, context: why.context }); continue; }
        survivors.push({ v: v, descLen: desc.length });
      } catch (e) {
        unreadable.push(v.id);
      }
      await sleep(PAUSE_MS);
    }
  }
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  // Шаг 4: дедупликация по компании и заголовку.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
  const groups = new Map();
  const fresh = [];
  const dup = [];
  for (const s of survivors) {
    const key = (s.v.co || '') + '|' + norm(s.v.title);
    if (groups.has(key)) { dup.push(s.v.id + ' = ' + groups.get(key)); continue; }
    groups.set(key, s.v.id);
    fresh.push(s);
  }

  // Дубль по названию работодателя, когда оно неизвестно.
  // У части карточек в выдаче нет названия компании, и тогда ключ
  // «пустая компания + заголовок» у разных вакансий различается: одинаковые
  // заголовки проходят как новые. Примеры из прогона — 137280835
  // «Backend-разработчик / MCP Engineer» это второй id той же вакансии
  // Foxible, что 137280834, а 137661544 «Аналитик данных Junior» — второй id
  // вакансии SDO, что 137661543. Обе уже в очереди.
  const knownByCompany = new Map();
  const knownTitles = new Map();
  for (const src of shortlist) {
    if (src.co) knownByCompany.set(norm(src.title) + '|' + norm(src.co), src.id);
    knownTitles.set(norm(src.title), src.id);
  }
  const stillFresh = [];
  for (const s of fresh) {
    if (s.v.co) {
      const knownId = knownByCompany.get(norm(s.v.title) + '|' + norm(s.v.co));
      if (knownId) { dup.push(s.v.id + ' = ' + knownId + ' (уже в очереди)'); continue; }
    } else {
      const knownId = knownTitles.get(norm(s.v.title));
      if (knownId) { dup.push(s.v.id + ' = ' + knownId + ' (тот же заголовок, компания не указана)'); continue; }
    }
    stillFresh.push(s);
  }
  fresh.length = 0;
  fresh.push(...stillFresh);

  fresh.sort(function (a, b) {
    // Порядок очереди: сначала то, что ближе к его позиционированию.
    const rank = function (t) {
      const s = t.toLowerCase();
      if (/python/.test(s)) return 0;
      if (/backend|бэкенд|api|rest/.test(s)) return 1;
      if (/qa|тестиров|тест-инженер|автотест/.test(s)) return 2;
      if (/автоматизац|парсер|парсинг|бот/.test(s)) return 3;
      if (/devops|sre/.test(s)) return 4;
      if (/аналитик|инженер|разработчик/.test(s)) return 5;
      return 6;
    };
    return rank(a.v.title) - rank(b.v.title);
  });

  const report = {
    generated: new Date().toISOString().slice(0, 10),
    thresholdMonths: MONTH_THRESHOLD,
    queries: QUERIES.length,
    cards: seen.size,
    byReason: byReason,
    survivors: fresh.map((s) => ({ id: s.v.id, title: s.v.title, company: s.v.co, exp: s.v.exp, descLen: s.descLen })),
    rejectedByDescription: rejected.map((r) => ({ id: r.v.id, title: r.v.title, company: r.v.co, rule: r.rule, matched: r.matched || '' })),
    duplicates: dup,
    unreadable: unreadable,
  };
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(report, null, 1) + '\n', 'utf8');

  console.log('прошли всё: ' + fresh.length);
  for (const s of fresh.slice(0, 40)) console.log('  ' + s.v.id + ' | ' + s.v.exp + ' | ' + s.v.title.slice(0, 48) + ' | ' + (s.v.co || '').slice(0, 24));
  console.log('отсеяно по описанию: ' + rejected.length + ', дублей: ' + dup.length + ', не прочитано: ' + unreadable.length);
  const byRule = {};
  for (const r of rejected) byRule[r.rule] = (byRule[r.rule] || 0) + 1;
  console.log('причины по описанию: ' + JSON.stringify(byRule));
  console.log('отчёт: ' + OUT);
  return unreadable.length === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.log('сбор упал: ' + (e && e.stack));
    process.exit(1);
  });