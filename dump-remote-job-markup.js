// Полный фрагмент разметки: одна карточка из списка и блок описания вакансии.
// Нужен, чтобы не гадать с селекторами при написании сборщика.
//
// Использование: node dump-remote-job-markup.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body }));
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

function slice(html, marker, before, after) {
  const i = html.indexOf(marker);
  if (i < 0) return '(маркер не найден: ' + marker + ')';
  return html.slice(Math.max(0, i - before), i + after).replace(/\s+/g, ' ');
}

(async function () {
  const list = await get('https://remote-job.ru/search?query=python');
  console.log('=== карточка целиком ===');
  const i = list.body.indexOf('<div class="vacancy_item">');
  if (i >= 0) {
    const j = list.body.indexOf('<div class="vacancy_item">', i + 10);
    console.log(list.body.slice(i, j > 0 ? j : i + 2600).replace(/\s+/g, ' ').slice(0, 2600));
  }

  const m = list.body.match(/\/vacancy\/show\/(\d+)\/([a-z0-9-]+)/);
  if (!m) { console.log('нет ни одной ссылки на вакансию'); return; }
  const v = await get('https://remote-job.ru/vacancy/show/' + m[1] + '/' + m[2]);
  console.log('');
  console.log('=== вакансия ' + m[1] + ' ===');
  // Где начинается текст описания: ищем характерные заголовки разделов.
  for (const marker of ['Опыт', 'Требования', 'Обязанности', 'Условия', 'О вакансии', 'vacancy_description', 'vacancy-text']) {
    const at = v.body.indexOf(marker);
    console.log('  ' + marker + ' → позиция ' + at);
  }
  console.log('--- фрагмент вокруг «Требования» ---');
  console.log(slice(v.body, 'Требования', 200, 1200));
  console.log('--- фрагмент вокруг «Опыт» ---');
  console.log(slice(v.body, 'Опыт', 150, 700));
})();
