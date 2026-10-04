// Сбор вакансий с Хабр Карьеры.
//
// Зачем свой сборщик, если есть браузер. Хабр Карьер отдаёт гостю всё
// состояние страницы в <script type="application/json">: 417 вакансий по
// запросу python за один заход, 17 страниц. Это значит, что сбор идёт из node
// без браузера, как на hh, и его можно повторить в любой момент.
//
// Отличия от hh, которые здесь учтены:
//   * Уровень задан полем qualification: Intern, Middle, Senior. Слова
//     «junior» в заголовке может не быть вообще, поэтому фильтр по заголовку
//     здесь бесполезен — берём поле.
//   * Удалённость — поле remoteWork, а не слова в тексте.
//   * Отклик требует входа и заполнения формы, в том числе ответов на вопросы,
//     поэтому применение делается отдельно, а не отправкой формы вслепую.
//
// Фильтры опыта и заголовков те же, что на hh: из hh-target.js. Причина одна —
// отказ по стеку там и тут стоит одинаково дорого.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { judge } = require('./hh-target.js');
const { reasonIn, MONTH_THRESHOLD } = require('./hh-experience.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://career.habr.com/vacancies';
const PAGES_PER_QUERY = 6;
const PAUSE_MS = 700;
const CONCURRENCY = 2;
const OUT = 'habr-vacancies.json';

// Senior и Lead отбрасываются всегда. Junior, Intern и пустой уровень берём.
// Middle тоже берём, но в конец очереди: на Хабре метка часто не проставлена
// верно, у мелких компаний «Middle» — это просто junior-позиция без HR.
// Решение «сойдёт или нет» принимает правило опыта по тексту описания, а не
// метка: 146 отсеянных Middle содержали вакансии без единого требования
// по опыту.
const LEVELS_EXCLUDE = ['senior', 'lead', 'head of', 'manager'];
// Порядок в очереди: чем ниже метка, тем раньше.
const LEVEL_ORDER = { intern: 0, junior: 1, 'не указан': 2, middle: 3 };

const QUERIES = [
  'python разработчик',
  'стажер python',
  'python backend',
  'тестировщик стажер',
  'qa инженер стажер',
  'автоматизация тестирования',
  'c++ разработчик',
  'junior разработчик',
  'стажер разработчик',
  'devops стажер',
  'python удаленно',
  'боты telegram python',
  // Добавлены после первого прогона: на Хабре стажировки сидят под
  // формулировками «стажёр», «интерн», «trainee», а удалённость не пишут
  // в заголовке, поэтому запросы строятся вокруг роли и формата.
  'стажёр python',
  'стажер тестировщик',
  'интерн python',
  'trainee разработчик',
  'junior python',
  'стажер c++',
  'стажер devops',
  'автоматизатор python',
  'тестировщик удаленно',
  'qa удаленно',
  'junior qa',
  'стажёр тестировщик',
];

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9', Accept: 'text/html' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body }));
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stateOf(html) {
  const m = html.match(/<script type="application\/json"[^>]*>([\s\S]{1,600000}?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

function readApplied(file) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return [];
  const raw = fs.readFileSync(full, 'utf8');
  const ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  if (raw.trim() && ids.length === 0) {
    throw new Error(file + ' не пуст, но ни один id не разобрался — формат изменился, дальше не идём');
  }
  return ids;
}

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&quot;/g, '"'], [/&laquo;/g, '«'], [/&raquo;/g, '»'],
  [/&mdash;/g, '—'], [/&ndash;/g, '–'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&#39;/g, "'"],
];

function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|li|div|h[1-6]|tr|span)>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

// Описание вакансии на Хабре лежит в div.faded-content__body и НЕ имеет
// data-qa: поиск по data-qa="vacancy-description" не находит ничего, и все
// вакансии уходили в «не прочитано». Заголовок «Описание вакансии» — часть
// блока, поэтому отрезается.
function descriptionOf(html) {
  const byQa = html.indexOf('data-qa="vacancy-description"');
  if (byQa >= 0) {
    const start = html.indexOf('>', byQa);
    if (start > 0) {
      const close = html.indexOf('data-qa="vacancy-description-next"', start);
      return htmlToText(html.slice(start, close > 0 ? close : Math.min(html.length, start + 80000)));
    }
  }
  const byClass = html.indexOf('faded-content__body');
  if (byClass >= 0) {
    const start = html.indexOf('>', byClass);
    const end = html.indexOf('faded-content__body', byClass + 30);
    const stop = end > 0 ? html.lastIndexOf('</div>', end) : -1;
    return htmlToText(html.slice(start + 1, stop > 0 ? stop : Math.min(html.length, start + 90000)));
  }
  // Запасной путь: текст после заголовка «Описание вакансии».
  const byHeading = html.indexOf('Описание вакансии');
  if (byHeading >= 0) return htmlToText(html.slice(byHeading + 16, byHeading + 90000));
  return '';
}

function normalize(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
}

async function main() {
  const applied = readApplied('habr-applied-ids.txt');
  console.log('уже откликов на Хабре: ' + applied.length);

  // Шаг 1: собрать карточки.
  const seen = new Map();
  const stats = { byLevel: {}, byQuery: {}, levels: {}, remote: { yes: 0, no: 0 } };
  for (const q of QUERIES) {
    let got = 0;
    for (let page = 1; page <= PAGES_PER_QUERY; page++) {
      const url = BASE + '?q=' + encodeURIComponent(q) + '&type=all&page=' + page;
      const r = await get(url);
      if (r.status !== 200) break;
      const state = stateOf(r.body);
      if (!state || !state.vacancies || !Array.isArray(state.vacancies.list)) break;
      const list = state.vacancies.list;
      if (!list.length) break;
      got += list.length;
      for (const v of list) {
        const lvl = String(v.qualification || 'не указан');
        stats.levels[lvl] = (stats.levels[lvl] || 0) + 1;
        stats.remote[v.remoteWork ? 'yes' : 'no'] += 1;
        if (seen.has(String(v.id))) continue;
        seen.set(String(v.id), {
          id: String(v.id),
          title: v.title || '',
          company: (v.company && (v.company.title || v.company.alias_name)) || '',
          companyAlias: (v.company && v.company.alias_name) || '',
          remote: !!v.remoteWork,
          level: lvl,
          employment: v.employment || '',
          published: v.publishedDate || '',
          skills: (v.skills || []).map((s) => (typeof s === 'string' ? s : s && s.title) || '').filter(Boolean),
          href: v.href || ('/vacancies/' + v.id),
          quickResponse: v.quickResponseHref || '',
          responses: v.reactions ? (v.reactions.count || 0) : null,
        });
      }
      await sleep(PAUSE_MS);
    }
    stats.byQuery[q] = got;
  }

  const all = [...seen.values()];
  console.log('карточек уникальных: ' + all.length);
  console.log('уровни в выдаче: ' + JSON.stringify(stats.levels));
  console.log('удалённых: ' + stats.remote.yes + ', не удалённых: ' + stats.remote.no);

  // Шаг 2: уровень, удалённость, заголовок, компания.
  const byReason = {};
  const step2 = [];
  for (const v of all) {
    const lvl = normalize(v.level);
    if (LEVELS_EXCLUDE.some((x) => lvl.indexOf(x) >= 0)) {
      byReason['уровень: ' + (v.level || 'не указан')] = (byReason['уровень: ' + (v.level || 'не указан')] || 0) + 1;
      continue;
    }
    if (!v.remote) { byReason['не удалённая'] = (byReason['не удалённая'] || 0) + 1; continue; }
    if (applied.indexOf(v.id) >= 0) { byReason['уже отклик'] = (byReason['уже отклик'] || 0) + 1; continue; }
    const j = judge({ title: v.title, company: v.company });
    if (!j.ok) { byReason[j.reason] = (byReason[j.reason] || 0) + 1; continue; }
    step2.push(v);
  }
  console.log('после уровня, удалённости и заголовка: ' + step2.length);
  console.log('отсеяно: ' + JSON.stringify(byReason));

  // Шаг 3: описание и правило опыта.
  const survivors = [];
  const rejected = [];
  const unreadable = [];
  let cursor = 0;
  async function worker() {
    while (cursor < step2.length) {
      const v = step2[cursor++];
      const r = await get('https://career.habr.com' + v.href);
      const desc = r.status === 200 ? descriptionOf(r.body) : '';
      if (!desc) { unreadable.push(v.id + (r.status ? ' (HTTP ' + r.status + ')' : ' (соединение)')); await sleep(PAUSE_MS); continue; }
      const closed = /вакансия закрыта|вакансия больше не актуальна|архив/i.test(desc);
      if (closed) { rejected.push({ v: v, rule: 'closed' }); await sleep(PAUSE_MS); continue; }
      const why = reasonIn(desc);
      if (why) { rejected.push({ v: v, rule: why.rule, matched: why.matched }); await sleep(PAUSE_MS); continue; }
      survivors.push({ v: v, desc: desc, descLen: desc.length });
      await sleep(PAUSE_MS);
    }
  }
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  // Шаг 4: дедупликация по компании и заголовку.
  const groups = new Map();
  const fresh = [];
  const dup = [];
  for (const s of survivors) {
    const key = normalize(s.v.company) + '|' + normalize(s.v.title);
    if (groups.has(key)) { dup.push(s.v.id + ' = ' + groups.get(key)); continue; }
    groups.set(key, s.v.id);
    fresh.push(s);
  }

  // Порядок очереди: Intern и Junior первыми, Middle последними.
  fresh.sort(function (a, b) {
    const la = LEVEL_ORDER[normalize(a.v.level)] === undefined ? 9 : LEVEL_ORDER[normalize(a.v.level)];
    const lb = LEVEL_ORDER[normalize(b.v.level)] === undefined ? 9 : LEVEL_ORDER[normalize(b.v.level)];
    if (la !== lb) return la - lb;
    return Number(b.v.responses || 0) - Number(a.v.responses || 0);
  });

  const report = {
    generated: new Date().toISOString().slice(0, 10),
    thresholdMonths: MONTH_THRESHOLD,
    queries: QUERIES.length,
    cards: all.length,
    byReason: byReason,
    levelDistribution: stats.levels,
    vacancies: fresh.map((s) => ({
      id: s.v.id, title: s.v.title, company: s.v.company, level: s.v.level,
      remote: s.v.remote, employment: s.v.employment, published: s.v.published,
      skills: s.v.skills, href: s.v.href, responses: s.v.responses,
      desc: s.desc.slice(0, 4000), descLen: s.descLen,
    })),
    rejectedByDescription: rejected.map((r) => ({ id: r.v.id, title: r.v.title, company: r.v.company, rule: r.rule, matched: r.matched || '' })),
    duplicates: dup,
    unreadable: unreadable,
  };
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(report, null, 1) + '\n', 'utf8');

  console.log('прошли всё: ' + fresh.length);
  for (const s of fresh) console.log('  ' + s.v.id + ' | ' + s.v.level + ' | ' + s.v.title.slice(0, 46) + ' | ' + s.v.company.slice(0, 26) + (s.v.responses ? ' | откликов ' + s.v.responses : ''));
  const byRule = {};
  for (const r of rejected) byRule[r.rule] = (byRule[r.rule] || 0) + 1;
  console.log('отсеяно по описанию: ' + rejected.length + ' ' + JSON.stringify(byRule));
  console.log('дублей: ' + dup.length + ', не прочитано: ' + unreadable.length);
  console.log('отчёт: ' + OUT);
  return unreadable.length === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.log('сбор упал: ' + (e && e.stack));
    process.exit(1);
  });