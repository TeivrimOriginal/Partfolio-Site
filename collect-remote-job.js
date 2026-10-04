// Сбор вакансий с remote-job.ru.
//
// Зачем третья доска. hh отдал 127 откликов, пул удалёнки исчерпан; на Хабр
// Карьере после 24 запросов осталось 4 вакансии. Остались Preparation-слова,
// которые снимают отсев по заголовку: эта доска отдаёт вакансии сервером, без
// входа и без капчи, поэтому собрать её можно, пока отклики ждут логина.
//
// Отличия от остальных сборщиков, которые здесь важны:
//   * Пагинация — обычный параметр &page, подгрузки скриптом нет. Проверено:
//     page=2 не пересекается с первой страницей, а page_number, offset, start
//     молча возвращают первую страницу, и такой сборщик тихо собрал бы 20
//     вакансий и объявил их всем.
//   * Разметка карточки — div.vacancy_item с h2 > a[href^="/vacancy/show/"],
//     компания в small > a[href*="companyName"], зарплата в h3, короткое
//     описание в последнем div класса col-xs-12.
//   * Описание вакансии — от текста «Описание вакансии» до «Откликнуться».
//     Искать надо без учёта регистра: слово «требования» в разметке встречается
//     с маленькой буквы, и поиск с большой не находит ничего.
//
// Фильтры те же, что на hh и Хабре: judge из hh-target.js и правило опыта из
// hh-experience.js. Причина одна — отказ по стеку одинаково дорог на всех
// площадках.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { judge } = require('./hh-target.js');
const { reasonIn, MONTH_THRESHOLD } = require('./hh-experience.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://remote-job.ru';
const PAGES_PER_QUERY = 4;
const PAUSE_MS = 700;
const CONCURRENCY = 2;
const OUT = 'remote-job-vacancies.json';

const QUERIES = [
  'junior python',
  'python разработчик',
  'стажер python',
  'python fastapi',
  'qa python',
  'тестировщик python',
  'автоматизация тестирования',
  'python telegram бот',
  'junior backend',
  'c++ разработчик',
  'junior devops',
  'python удаленно',
  'стажер разработчик',
  'junior тестировщик',
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

// Зарплата как признак уровня. Не как «лучше/хуже», а как фильтр mismatched
// вакансий: на этой доске в выдаче были «Python-разработчик» за 300–370 тысяч
// и «QA-инженер» за 211 тысяч. Джуну без опыта работы там нечего предложить,
// кроме как потратить отклик. Порог 150 тысяч — верхняя граница того, что
// платят за удалённый junior; выше начинается middle.
const SALARY_FLOOR_JUNIOR = 150000;

// «от 60 000 до 200 000 руб.» → 60000. «з.п. не указана» → null.
function salaryFloor(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s || /не указана|не указан|по результатам|договорн/i.test(s)) return null;
  const nums = s.match(/[\d][\d\s ]{2,}/g);
  if (!nums) return null;
  const first = Number((nums[0].match(/[\d\s ]+/)[0] || '').replace(/[\s ]/g, ''));
  return isFinite(first) ? first : null;
}

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&quot;/g, '"'], [/&laquo;/g, '«'], [/&raquo;/g, '»'],
  [/&mdash;/g, '—'], [/&ndash;/g, '–'], [/&times;/g, '×'], [/&laquo;/g, '«'], [/&lt;/g, '<'],
  [/&gt;/g, '>'], [/&#39;/g, "'"], [/&middot;/g, '·'], [/&bull;/g, '•'], [/&#8470;/g, '№'],
];

function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|li|div|h[1-6]|tr|span|td|th)>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function normalize(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
}

// Карточка: заголовок, компания, зарплата, короткое описание.
function parseCards(html) {
  const out = [];
  const blocks = html.split('<div class="vacancy_item">').slice(1);
  for (const b of blocks) {
    const link = b.match(/<a[^>]*href="\/vacancy\/show\/(\d+)\/([a-z0-9\-]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const id = link[1];
    const slug = link[2];
    const title = htmlToText(link[3]);
    if (!title) continue;
    const company = (b.match(/companyName=([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) || [])[2] || '';
    const salary = (b.match(/<h3>([\s\S]*?)<\/h3>/i) || [])[1] || '';
    // Короткое описание — последний блок класса col-xs-12 внутри карточки.
    const cols = b.split('col-xs-12');
    const short = cols.length > 1 ? htmlToText(cols[cols.length - 1]).slice(0, 400) : '';
    out.push({
      id: id,
      slug: slug,
      title: title,
      company: htmlToText(company),
      salary: htmlToText(salary),
      short: short,
      href: '/vacancy/show/' + id + '/' + slug,
      remote: /удаленн|удалённ|remote/i.test(title),
    });
  }
  return out;
}

// Описание: от «Описание вакансии» до «Откликнуться». Регистр не учитываем.
function descriptionOf(html) {
  const m = /Описание\s+вакансии/i.exec(html);
  if (!m) return '';
  const from = m.index;
  const stops = ['Откликнуться', 'похожие вакансии', 'Поделиться'];
  let to = html.length;
  for (const s of stops) {
    const at = html.indexOf(s, from);
    if (at > 0 && at < to) to = at;
  }
  return htmlToText(html.slice(from, to));
}

// Запасной путь. 19 вакансий из первого прогона вернули меньше 200 символов:
// у части страниц заголовок «Описание вакансии» стоит в мета-теге, и окно до
// «Откликнуться» выходит пустым. Тогда берём текст страницы целиком и отрезаем
// шапку и подвал по известным маркерам.
function descriptionFallback(html) {
  let t = htmlToText(html);
  const start = t.search(/Описание\s+вакансии/i);
  if (start >= 0) t = t.slice(start);
  const at = t.indexOf('Откликнуться');
  if (at > 200) t = t.slice(0, at);
  // Отрезаем хвост навигации.
  for (const tail of ['Мы в соцсетях', 'Сервис Техподдержка', 'Поиск заданий']) {
    const p = t.indexOf(tail);
    if (p > 400) t = t.slice(0, p);
  }
  return t.trim();
}

function readApplied(file) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return [];
  const raw = fs.readFileSync(full, 'utf8');
  const ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  if (raw.trim() && ids.length === 0) {
    throw new Error(file + ' не пуст, но id не разобрались — формат изменился, дальше не идём');
  }
  return ids;
}

async function main() {
  const applied = readApplied('remote-job-applied-ids.txt');
  console.log('уже откликов на remote-job: ' + applied.length);

  const seen = new Map();
  const byQuery = {};
  for (const q of QUERIES) {
    let got = 0;
    for (let page = 1; page <= PAGES_PER_QUERY; page++) {
      const url = BASE + '/search?query=' + encodeURIComponent(q) + '&page=' + page;
      const r = await get(url);
      if (r.status !== 200) break;
      const cards = parseCards(r.body);
      if (!cards.length) break;
      got += cards.length;
      for (const c of cards) {
        if (seen.has(c.id)) continue;
        seen.set(c.id, c);
      }
      await sleep(PAUSE_MS);
    }
    byQuery[q] = got;
  }

  const all = [...seen.values()];
  console.log('карточек уникальных: ' + all.length);
  console.log('по запросам: ' + JSON.stringify(byQuery));

  // Шаг 2: заголовок и компания.
  const byReason = {};
  const step2 = [];
  for (const v of all) {
    if (applied.indexOf(v.id) >= 0) { byReason['уже отклик'] = (byReason['уже отклик'] || 0) + 1; continue; }
    const floor = salaryFloor(v.salary);
    v.salaryFloor = floor;
    if (floor !== null && floor >= SALARY_FLOOR_JUNIOR) {
      byReason['зарплата от ' + Math.round(floor / 1000) + ' тыс.'] = (byReason['зарплата от ' + Math.round(floor / 1000) + ' тыс.'] || 0) + 1;
      continue;
    }
    const j = judge({ title: v.title, company: v.company });
    if (!j.ok) { byReason[j.reason] = (byReason[j.reason] || 0) + 1; continue; }
    step2.push(v);
  }
  console.log('после заголовка и компании: ' + step2.length);
  console.log('отсеяно: ' + JSON.stringify(byReason));

  // Шаг 3: описание и правило опыта.
  const survivors = [];
  const rejected = [];
  const unreadable = [];
  let cursor = 0;
  async function worker() {
    while (cursor < step2.length) {
      const v = step2[cursor++];
      const r = await get(BASE + v.href);
      let desc = r.status === 200 ? descriptionOf(r.body) : '';
      if (desc.length < 200 && r.status === 200) desc = descriptionFallback(r.body);
      if (!desc || desc.length < 200) {
        unreadable.push(v.id + (r.status ? ' (HTTP ' + r.status + ')' : ' (соединение)') + (desc ? ' (текст ' + desc.length + ')' : ''));
        await sleep(PAUSE_MS);
        continue;
      }
      const closed = /вакансия (?:закрыта|более не актуальна)|вакансия удалена/i.test(desc);
      if (closed) { rejected.push({ v: v, rule: 'closed' }); await sleep(PAUSE_MS); continue; }
      const why = reasonIn(desc + ' ' + v.title);
      if (why) { rejected.push({ v: v, rule: why.rule, matched: why.matched || '' }); await sleep(PAUSE_MS); continue; }
      survivors.push({ v: v, desc: desc });
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

  const report = {
    generated: new Date().toISOString().slice(0, 10),
    board: 'remote-job.ru',
    thresholdMonths: MONTH_THRESHOLD,
    queries: QUERIES.length,
    pagesPerQuery: PAGES_PER_QUERY,
    cards: all.length,
    byReason: byReason,
    vacancies: fresh.map((s) => ({
      id: s.v.id,
      title: s.v.title,
      company: s.v.company,
      salary: s.v.salary,
      salaryFloor: s.v.salaryFloor === undefined ? null : s.v.salaryFloor,
      href: BASE + s.v.href,
      short: s.v.short,
      desc: s.desc.slice(0, 4000),
      descLen: s.desc.length,
    })),
    rejectedByDescription: rejected.map((r) => ({ id: r.v.id, title: r.v.title, company: r.v.company, rule: r.rule, matched: r.matched || '' })),
    duplicates: dup,
    unreadable: unreadable,
  };
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(report, null, 1) + '\n', 'utf8');

  console.log('прошли всё: ' + fresh.length);
  for (const s of fresh) {
    console.log('  ' + s.v.id + ' | ' + s.v.title.slice(0, 52) + ' | ' + s.v.company.slice(0, 24) + (s.v.salary ? ' | ' + s.v.salary.slice(0, 30) : ''));
  }
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
