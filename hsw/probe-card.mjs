// Отладка разбора карточки выдачи. Отдельным файлом, потому что `node -e` с
// регулярками ломает PowerShell (гребля из NOTES, повторялась дважды).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = 'https://hh.ru/search/vacancy?area=113&work_format=REMOTE&text='
  + encodeURIComponent('python разработчик') + '&page=0';

// hh регулярно рвёт соединение (ECONNRESET) — это норма для него, а не исключение.
let html = '';
for (let a = 0; a < 5 && !html; a++) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    const t = await r.text();
    if (t.length > 5000) html = t;
  } catch (e) {
    console.log(`  попытка ${a}: ${e.cause?.code || e.message}`);
  }
  if (!html) await sleep(2500 + a * 3500);
}
if (!html) { console.log('страница не пришла'); process.exit(1); }

const chunks = html.split('data-qa="vacancy-serp__vacancy"').slice(1);
console.log('chunks:', chunks.length);

const PATTERNS = {
  'A /vacancy/(\\d+)[?"\\/]': /vacancy\/(\d+)[?"\/]/,
  'B href=[^"]*\\/vacancy\\/(\\d+)': /href="[^"]*\/vacancy\/(\d+)/,
  'C /vacancy/(\\d+)': /\/vacancy\/(\d+)/,
};

for (const [name, re] of Object.entries(PATTERNS)) {
  const hits = chunks.slice(0, 5).map((c) => (c.match(re) || [])[1]);
  console.log(name, '->', JSON.stringify(hits));
}

const c = chunks[0];
const ti = c.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,300}?)<\/span><\/span><\/span>/);
console.log('title raw len:', ti ? ti[1].length : 'NULL');
console.log('title:', ti ? ti[1].replace(/<[^>]+>/g, '').trim().slice(0, 60) : 'NULL');
console.log('exp:', (c.match(/work-experience-([A-Za-z0-9]+)/) || [])[1] || 'none');
console.log('remote label:', /work-schedule-remote/i.test(c));
console.log('salary data tags:', (c.match(/<data value="(\d+)"/g) || []).slice(0, 3).join(' '));
console.log('--- first 300 chars of chunk ---');
console.log(JSON.stringify(c.slice(0, 300)));