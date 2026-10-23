import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ARGS = process.argv.slice(2);
const area = ARGS[0] || '1275';
const maxPages = Number(ARGS[1] || 12);

const TAGS = ['частичная занятость', 'полная занятость', 'сменный график', 'гибкий график',
  'удалённая работа', 'удаленная работа', 'вахтовый метод', 'круглосуточная работа', 'ночная смена'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function page(n) {
  const url = `https://hh.ru/search/vacancy?area=${area}&order_by=publication_time&items_on_page=50&page=${n}&search_field=all`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    const t = await r.text();
    if (r.status === 200 && t.includes('vacancy-serp__vacancy')) return t;
    console.log(`  page ${n} attempt ${attempt}: status ${r.status} len ${t.length}`);
    await sleep(4000 + attempt * 5000);
  }
  return null;
}

const out = new Map();
let truncated = false;
for (let n = 0; n < maxPages; n++) {
  const html = await page(n);
  if (!html) { console.log('stop at page', n, 'no data'); break; }
  const cards = html.split('<article data-qa="vacancy-serp__vacancy').slice(1);
  console.log(`page ${n}: cards ${cards.length}`);
  if (!cards.length) { console.log('end of list / throttled, html len', html.length, 'nothing-found:', /Ничего не найдено|ничего не найдено/.test(html)); break; }
  for (const c of cards) {
    const id = (c.match(/vacancy\/(\d+)[?"\/]/) || [])[1];
    if (!id) continue;
    const titleEl = c.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]*?)<\/span><\/span><\/span>/);
    const title = titleEl ? strip(titleEl[1]) : '';
    const salary = [...c.matchAll(/<data value="(\d+)"[^>]*>([\d\s]+)<\/data>/g)].map(m => Number(m[1]));
    const expM = c.match(/data-qa="vacancy-serp__vacancy-work-experience-(\w+)"/);
    const experience = expM ? expM[1] : '';
    const text = strip(c);
    const tags = TAGS.filter(k => text.toLowerCase().includes(k));
    const emp = (c.match(/data-qa="serp-item__vacancy-employer-name"[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    const closed = /Вы откликнулись|вакансия закрыта|Вакансия закрыта/.test(strip(c)) && /неактуальна/i.test(text);
    out.set(id, {
      id, title, salaryFrom: salary[0] ?? null, salaryTo: salary[1] ?? null,
      experience, tags, employer: emp ? strip(emp) : '', url: `https://hh.ru/vacancy/${id}`,
    });
  }
  if (cards.length < 10) { console.log('last page (few cards)'); break; }
  await sleep(1800);
}

const list = [...out.values()];
fs.writeFileSync(`zvac-area${area}.json`, JSON.stringify(list, null, 1));
console.log('collected', list.length, '->', `zvac-area${area}.json`);
const byExp = {};
for (const v of list) byExp[v.experience] = (byExp[v.experience] || 0) + 1;
console.log('by experience', JSON.stringify(byExp));
const byTag = {};
for (const v of list) for (const t of v.tags) byTag[t] = (byTag[t] || 0) + 1;
console.log('by tag', JSON.stringify(byTag));