// Соседние с Заречным пункты. Запросов меньше, чем в zbroad: важны ИТ,
// без опыта, подработка и частичная занятость — то, что берут студентом.
//
// Запуск: node zneigh.mjs <areaId> [pagesPerQuery]
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const RETRY = [2500, 6000, 15000];
const AREA = process.argv[2] || '4102';
const MAXPAGES = Number(process.argv[3] || 2);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();

const QUERIES = [
  'оператор ПК', '1С', 'программист', 'системный администратор', 'тестировщик',
  'ввод данных', 'сборщик данных', 'копирайт', 'дизайнер', 'контент менеджер',
  'администратор', 'делопроизводитель', 'секретарь', 'бухгалтер', 'кассир',
  'продавец', 'менеджер', 'кладовщик', 'комплектовщик', 'упаковщик', 'грузчик',
  'рабочий', 'разнорабочий', 'сборщик', 'сварщик', 'электрик', 'монтажник',
  'санитар', 'уборщик', 'курьер', 'стажер', 'без опыта', 'частичная занятость',
  'гибкий график', 'подработка', 'студент', 'учиться', 'без высшего образования',
  'диспетчер', 'сборщик заказов', 'классификатор', 'скандировщик',
];

async function fetchText(url) {
  for (let attempt = 0; attempt <= RETRY.length; attempt++) {
    if (attempt > 0) await sleep(RETRY[attempt - 1]);
    try {
      const r = await fetch(HOSTS[attempt % HOSTS.length] + url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      const t = await r.text();
      if (r.status === 200 && t.length > 5000) return t;
    } catch { /* retry */ }
  }
  return '';
}

function cardsOf(html) {
  const out = [];
  for (const chunk of html.split('data-qa="vacancy-serp__vacancy"').slice(1)) {
    const idm = chunk.match(/vacancy\/(\d+)[?"\/]/);
    if (!idm) continue;
    const body = chunk.slice(0, 7000);
    const ti = body.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,300}?)<\/span><\/span><\/span>/);
    const exp = (body.match(/work-experience-([A-Za-z0-9]+)/) || [])[1] || '';
    const sal = [...body.matchAll(/<data value="(\d+)"[^>]*>/g)].map(m => Number(m[1]));
    const emp = (body.match(/data-qa="serp-item__vacancy-employer-text"[^>]*>([\s\S]{0,200}?)<\/span>/) || [])[1];
    out.push({
      id: idm[1],
      title: ti ? strip(ti[1]) : '',
      employer: emp ? strip(emp) : '',
      exp,
      from: sal[0] ?? null,
      to: sal[1] ?? null,
      url: 'https://hh.ru/vacancy/' + idm[1],
    });
  }
  return out;
}

const seen = new Map();
let pages = 0;
for (const q of QUERIES) {
  let got = 0;
  for (let p = 0; p < MAXPAGES; p++) {
    const html = await fetchText(`/search/vacancy?area=${AREA}&order_by=publication_time&items_on_page=50&text=${encodeURIComponent(q)}&page=${p}`);
    const cards = cardsOf(html);
    if (!cards.length) break;
    pages++; got += cards.length;
    for (const c of cards) {
      if (!seen.has(c.id)) seen.set(c.id, { ...c, area: AREA, queries: [q] });
      else seen.get(c.id).queries.push(q);
    }
    await sleep(600);
  }
  process.stdout.write(`[${q}] ${got}\n`);
}

const list = [...seen.values()];
fs.writeFileSync(`zneigh-area${AREA}.json`, JSON.stringify(list, null, 1), 'utf8');
const byExp = {};
for (const v of list) byExp[v.exp] = (byExp[v.exp] || 0) + 1;
console.log(`=== area ${AREA}: уникальных ${list.length}, страниц ${pages}, по опыту ${JSON.stringify(byExp)}`);
console.log(`без опыта: ${list.filter(v => v.exp === 'noExperience').length} -> zneigh-area${AREA}.json`);
