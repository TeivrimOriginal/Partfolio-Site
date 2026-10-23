// Где реально брать первый опыт, если опыта 0.
//
// Вопрос «что дальше при нулевом опыте» упирается в одно число: есть ли вообще
// вакансии, где требование по опыту не мешает. В NOTES записано, что в удалённой
// выдаче hh «опыт не требуется» даёт ноль — но это было сказано про один прогон
// по стеку Python и сделано фильтром, который сам отбрасывал Aston. Здесь
// проверка шире и без правил отбора: берём сырую выдачу hh и считаем метки
// опыта по каждому запросу, отдельно.
//
// Три зоны, потому что «где искать» и есть ответ:
//   113 + work_format=REMOTE — удалёнка по всей России;
//   3 — Свердловская область (Екб, Заречный, Нижний Тагил);
//   1 — Москва, где сконцентрированы стажировки и «ученик»-вакансии.
//
// Метки берём из карточки выдачи (data-qa="...work-experience-*"), а не из
// заголовка: заголовок «Junior» ничего не говорит про требование «от 2 лет».
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const RETRY = [2500, 6000, 15000];
const PAGES = 3;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const QUERIES = [
  'стажер python', 'стажер разработчик', 'стажёр python', 'ученик python',
  'junior python', 'python разработчик', 'python инженер', 'тестировщик junior',
  'qa junior', 'инженер по тестированию', 'автоматизация python', 'devops junior',
  'аналитик junior', 'python без опыта', 'разработчик стажировка',
];

const ZONES = [
  { key: 'remote-ru', q: 'area=113&work_format=REMOTE' },
  { key: 'sverdlovsk', q: 'area=3' },
  { key: 'moscow', q: 'area=1' },
];

const htmlToText = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function fetchText(url) {
  for (let attempt = 0; attempt <= RETRY.length; attempt++) {
    if (attempt > 0) await sleep(RETRY[attempt - 1]);
    try {
      const r = await fetch(HOSTS[attempt % HOSTS.length] + url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch (e) { /* retry */ }
  }
  return '';
}

function cardsOf(html) {
  const out = [];
  for (const chunk of html.split('data-qa="vacancy-serp__vacancy"').slice(1)) {
    const idm = chunk.match(/vacancy\/(\d+)[?"\/]/);
    if (!idm) continue;
    const body = chunk.slice(0, 6000);
    const ti = body.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,300}?)<\/span><\/span><\/span>/);
    const exp = (body.match(/work-experience-([A-Za-z0-9]+)/) || [])[1] || 'none';
    const sal = [...body.matchAll(/<data value="(\d+)"[^>]*>/g)].map(m => Number(m[1]));
    out.push({
      id: idm[1],
      title: ti ? htmlToText(ti[1]) : '',
      exp,
      from: sal[0] ?? null,
      to: sal[1] ?? null,
      remote: /work-schedule-remote/i.test(body),
    });
  }
  return out;
}

const report = { generated: new Date().toISOString().slice(0, 10), zones: {} };

for (const z of ZONES) {
  const seen = new Map();
  let pages = 0;
  const perQuery = {};
  for (const q of QUERIES) {
    let got = 0;
    for (let p = 0; p < PAGES; p++) {
      const html = await fetchText(`/search/vacancy?${z.q}&order_by=publication_time&text=${encodeURIComponent(q)}&page=${p}`);
      const cards = cardsOf(html);
      if (!cards.length) break;
      pages++; got += cards.length;
      for (const c of cards) if (!seen.has(c.id)) seen.set(c.id, { ...c, q });
      await sleep(700);
    }
    perQuery[q] = got;
  }
  const list = [...seen.values()];
  const byExp = {};
  for (const v of list) byExp[v.exp] = (byExp[v.exp] || 0) + 1;
  const noExp = list.filter(v => v.exp === 'noExperience');
  report.zones[z.key] = {
    area: z.q, queries: QUERIES.length, pages, cards: list.length,
    perQuery, byExp, noExperienceCount: noExp.length,
    noExperience: noExp.map(v => ({ id: v.id, title: v.title, from: v.from, to: v.to, remote: v.remote, q: v.q, url: 'https://hh.ru/vacancy/' + v.id })),
  };
  console.log(`\n=== ${z.key}: карточек ${list.length}, страниц ${pages}`);
  console.log('   по опыту: ' + JSON.stringify(byExp));
  console.log(`   «Без опыта»: ${noExp.length}`);
  for (const v of noExp.slice(0, 25)) console.log(`     ${v.id} | ${v.title.slice(0, 60)} | ${v.from || '—'}-${v.to || '—'}${v.remote ? ' | удалённо' : ''}`);
  fs.writeFileSync('zero-exp-pool.json', JSON.stringify(report, null, 1) + '\n', 'utf8');
}
console.log('\nотчёт: zero-exp-pool.json');