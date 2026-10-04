// Каталог Хабр Карьеры: сколько вакансий и отдаётся ли список без браузера.
//
// Зачем. Поиск /vacancies даёт 24 запроса и 580 карточек, а в шапке есть ещё
// /catalog/vacancies — полный каталог. Если он отдаётся тем же состоянием в
// script, это ещё один источник, и его можно прогнать теми же правилами.
//
// Использование: node probe-habr-catalog.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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

function stateOf(html) {
  const m = html.match(/<script type="application\/json"[^>]*>([\s\S]{1,2000000}?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

(async function () {
  for (const url of [
    'https://career.habr.com/catalog/vacancies',
    'https://career.habr.com/catalog/vacancies?page=2',
  ]) {
    const r = await get(url);
    console.log('--- ' + url + ' → HTTP ' + r.status + ', ' + r.body.length + ' Б');
    if (r.status !== 200) continue;
    const st = stateOf(r.body);
    if (!st) { console.log('   состояния в script нет'); continue; }
    const cat = st.catalog || st.vacancies || {};
    const list = Array.isArray(cat.list) ? cat.list : (Array.isArray(st.vacancies && st.vacancies.list) ? st.vacancies.list : null);
    console.log('   ключи состояния: ' + Object.keys(st).slice(0, 12).join(', '));
    if (list) {
      console.log('   вакансий на странице: ' + list.length + ', всего: ' + (cat.meta && (cat.meta.totalResults || cat.meta.total)) + ', страниц: ' + (cat.meta && cat.meta.totalPages));
      const first = list[0] || {};
      console.log('   ключи вакансии: ' + Object.keys(first).slice(0, 18).join(', '));
      console.log('   пример: ' + JSON.stringify({ id: first.id, title: first.title, company: first.company && first.company.title, remote: first.remoteWork, level: first.qualification }).slice(0, 240));
    } else {
      console.log('   список вакансий в состоянии не найден');
    }
    const ids = [...new Set((r.body.match(/href="\/vacancies\/(\d+)"/g) || []).map((x) => x.replace(/\D/g, '')))];
    console.log('   ссылок на вакансии в HTML: ' + ids.length + (ids.length ? ', первые: ' + ids.slice(0, 4).join(', ') : ''));
    const pages = [...new Set((r.body.match(/[?&](?:page)=(\d+)/g) || []))].slice(0, 6);
    console.log('   пагинация: ' + JSON.stringify(pages));
  }
})();
