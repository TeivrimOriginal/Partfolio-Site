// Проверяю связку cardsOf -> upsertVacancy на реальных данных: почему в базу
// попала одна строка с external_id = 'undefined'.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function get(url) {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch { /* retry */ }
    await sleep(2500 + a * 3500);
  }
  return '';
}

// Копия cardsOf из collect.mjs — специально чтобы сравнивать побайтно.
function cardsOf(html) {
  const out = [];
  for (const chunk of html.split('data-qa="vacancy-serp__vacancy"').slice(1)) {
    const idm = chunk.match(/vacancy\/(\d+)[?"\/]/);
    if (!idm) continue;
    const body = chunk.slice(0, 6000);
    const ti = body.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,300}?)<\/span><\/span><\/span>/);
    const exp = (body.match(/work-experience-([A-Za-z0-9]+)/) || [])[1] || '';
    const sal = [...body.matchAll(/<data value="(\d+)"[^>]*>/g)].map((m) => Number(m[1]));
    out.push({
      externalId: idm[1],
      title: ti ? strip(ti[1]) : '',
      exp,
      from: sal[0] ?? null,
      to: sal[1] ?? null,
      remote: /work-schedule-remote/i.test(body),
    });
  }
  return out;
}

const html = await get('https://hh.ru/search/vacancy?area=113&work_format=REMOTE&text=python%20%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D1%87%D0%B8%D0%BA&page=0');
const cards = cardsOf(html);
console.log('cards:', cards.length);
console.log('typeof externalId:', typeof cards[0].externalId, JSON.stringify(cards[0].externalId));
console.log('first 3:', cards.slice(0, 3).map((c) => `${c.externalId}/${c.title.slice(0, 30)}`).join(' | '));

// Считаем, сколько проходит фильтры по опыту
const EXP_OK = ['noExperience', 'between1And3'];
const byExp = {};
for (const c of cards) byExp[c.exp || 'none'] = (byExp[c.exp || 'none'] || 0) + 1;
console.log('by exp:', JSON.stringify(byExp));
console.log('прошли опыт:', cards.filter((c) => EXP_OK.includes(c.exp)).length);
console.log('remote:', cards.filter((c) => c.remote).length);