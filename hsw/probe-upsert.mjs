// Инструментирую цикл отбора: печатаю каждый переход и каждый вызов upsert.
// Догадками тут нельзя — уже было: молчаливый пустой результат выглядит как
// «рынок пуст», а на деле сломан разбор.
import { openDb, upsertVacancy, companyKey } from './db.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch { /* retry */ }
    await sleep(2500 + a * 3000);
  }
  return '';
}

const html = await get('https://hh.ru/search/vacancy?area=113&work_format=REMOTE&text=junior%20python&page=0');
console.log('html len:', html.length);

const chunks = html.split('data-qa="vacancy-serp__vacancy"').slice(1);
console.log('chunks:', chunks.length);

const seen = new Map();
for (const c of chunks) {
  const m = c.match(/vacancy\/(\d+)[?"\/]/);
  console.log('  chunk: match?', !!m, 'id =', m ? m[1] : 'NULL');
  if (!m) continue;
  seen.set(m[1], { id: m[1] });
}
console.log('seen.size:', seen.size);

const db = openDb('hsw/probe.sqlite');
for (const c of seen.values()) {
  const res = upsertVacancy(db, {
    source: 'hh', externalId: c.id, url: 'u' + c.id, title: 'T' + c.id,
    company: 'C', companyKey: companyKey('C'), remote: true, noExperience: true, noDegree: true,
  });
  console.log('  upsert', c.id, JSON.stringify(res));
}
console.log('rows:', db.prepare('SELECT COUNT(*) c FROM vacancies').get().c);
console.log('sample:', db.prepare('SELECT id, external_id, title FROM vacancies LIMIT 3').all());