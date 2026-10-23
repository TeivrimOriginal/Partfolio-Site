import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function page(url) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    const t = await r.text();
    if (r.status === 200) return t;
    await sleep(5000);
  }
  return '';
}

function parse(html) {
  const cards = html.split('<article data-qa="vacancy-serp__vacancy').slice(1);
  return cards.map(c => {
    const id = (c.match(/vacancy\/(\d+)[?"\/]/) || [])[1];
    const ti = c.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]*?)<\/span><\/span><\/span>/);
    const sal = [...c.matchAll(/<data value="(\d+)"[^>]*>([\d\s]+)<\/data>/g)].map(m => Number(m[1]));
    const exp = (c.match(/data-qa="vacancy-serp__vacancy-work-experience-(\w+)"/) || [])[1];
    return { id, title: ti ? strip(ti[1]) : '', from: sal[0] ?? null, to: sal[1] ?? null, exp };
  }).filter(v => v.id);
}

for (const [label, extra] of [['flexible', '&schedule=flexible'], ['shift', '&schedule=shift'], ['remote', '&work_format=REMOTE']]) {
  const all = new Map();
  for (let p = 0; p < 5; p++) {
    const html = await page(`https://hh.ru/search/vacancy?area=1275&order_by=publication_time&search_field=all${extra}&page=${p}`);
    const c = parse(html);
    for (const v of c) all.set(v.id, v);
    if (c.length < 10) break;
    await sleep(2000);
  }
  const list = [...all.values()];
  console.log(`\n=== ${label}: ${list.length}`);
  for (const v of list) console.log(' ', v.id, v.title.slice(0, 50), '|', v.from, '-', v.to, '|', v.exp);
  fs.writeFileSync(`zarechny-${label}.json`, JSON.stringify(list, null, 1));
}