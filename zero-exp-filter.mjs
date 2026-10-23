// Что делать дальше при нулевом коммерческом опыте: фильтр пула «Без опыта».
//
// zero-exp-search.mjs показал, что пул вакансий с меткой «Без опыта» большой:
// 115 удалённо, 64 в Свердловской области, 147 в Москве. Прежний вывод в NOTES
// («в удалённой выдаче опыт не требуется — ноль») получился потому, что смотрели
// на узкий стек Python и на фильтр с требованиями, а не на сырую выдачу.
//
// Здесь пул «Без опыта» фильтруется по его стеку и, главное, проверяется тем же
// правилом опыта, что и очередь откликов (hh-experience.js): если в описании
// есть «коммерческий опыт» или «от 12 месяцев», вакансия не годится — иначе
// это ровно тот отказ, из-за которого 14 из 15 первых отказов были Aston.
// Плюс проверяется, что вакансия ещё открыта (есть кнопка отклика).
import fs from 'node:fs';
import { reasonIn } from './hh-experience.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const RETRY = [2500, 6000, 15000];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const pool = JSON.parse(fs.readFileSync('zero-exp-pool.json', 'utf8'));

// Стек: то, что уже есть в резюме и в очереди откликов.
const STACK = [
  [/python/i, 'python'], [/llm|ии-инженер|ai /i, 'ai'],
  [/backend|бэкенд|разработчик|developer|инженер-программист/i, 'dev'],
  [/тест|qa|testops|автотест/i, 'qa'], [/devops|devsecops|системный/i, 'devops'],
  [/аналитик|анализ данных|data/i, 'analytic'], [/c\+\+/i, 'cpp'],
  [/автоматиз|n8n|интеграц/i, 'automation'],
];

function tags(title) {
  return STACK.filter(([re]) => re.test(title)).map(([, t]) => t);
}

async function fetchText(url) {
  for (let a = 0; a <= RETRY.length; a++) {
    if (a > 0) await sleep(RETRY[a - 1]);
    try {
      const r = await fetch(HOSTS[a % HOSTS.length] + url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch (e) { /* retry */ }
  }
  return '';
}

function descriptionOf(html) {
  const open = html.indexOf('data-qa="vacancy-description"');
  if (open < 0) return '';
  const start = html.indexOf('>', open);
  const close = html.indexOf('data-qa="vacancy-description-next"', start);
  return strip(html.slice(start, close > 0 ? close : Math.min(html.length, start + 60000)));
}

function employerOf(html) {
  for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(b[1]);
      for (const n of (j['@graph'] || [j])) {
        if (n['@type'] === 'JobPosting' && n.hiringOrganization) return n.hiringOrganization.name || '';
      }
    } catch (e) { /* skip */ }
  }
  return '';
}

const candidates = new Map();
for (const z of Object.values(pool.zones)) {
  for (const v of z.noExperience) {
    const t = tags(v.title);
    if (!t.length) continue;
    const key = v.id;
    if (!candidates.has(key)) candidates.set(key, { ...v, tags: t, zones: [] });
    candidates.get(key).zones.push(z.area);
  }
}
console.log('без опыта и по стеку: ' + candidates.size);

const good = [], dropped = [], closed = [];
for (const v of candidates.values()) {
  const html = await fetchText('/vacancy/' + v.id);
  if (!html) { closed.push({ id: v.id, title: v.title, why: 'не отдали страницу' }); continue; }
  const open = /data-qa="vacancy-response-link-top"/.test(html);
  if (!open) { closed.push({ id: v.id, title: v.title, why: 'вакансия закрыта' }); continue; }
  const desc = descriptionOf(html);
  const why = desc ? reasonIn(desc) : null;
  if (why) { dropped.push({ id: v.id, title: v.title, employer: employerOf(html), rule: why.rule, matched: why.matched, context: why.context }); console.log('  отсеяна ' + v.id + ' [' + why.rule + '] ' + (why.matched || '') + ' :: ' + v.title.slice(0, 40)); continue; }
  good.push({ ...v, employer: employerOf(html), valid: (html.match(/"validThrough":"([\d-]+)"/) || [])[1] || '', descLen: desc.length });
  console.log('  БЕРЁМ ' + v.id + ' | ' + (good[good.length - 1].employer || '?').slice(0, 26) + ' | ' + v.title.slice(0, 46) + ' | ' + v.tags.join('+') + ' | до ' + good[good.length - 1].valid);
  await sleep(1200);
}

fs.writeFileSync('zero-exp-fit.json', JSON.stringify({ generated: pool.generated, good, dropped, closed }, null, 1) + '\n', 'utf8');
console.log('\nпрошли: ' + good.length + ', отсеяно правилом опыта: ' + dropped.length + ', закрыто/не прочитано: ' + closed.length);