// gderabota.ru: какой адрес отдаёт список вакансий и есть ли свежие junior.
//
// Зачем. Три вакансии, найденные ранее через агрегатор, датированы 15 июля 2026,
// и в тексте прямо сказано «старт 20 июля 2026». К 5 октября такая стажировка уже
// идёт. Отклик туда не имеет смысла, нужен свежий список.
//
// Проверяются адреса вида /вакансии/ с текстовым поиском и без него.
//
// Использование: node probe-gderabota-list.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          resolve(get(new URL(loc, url).href, depth + 1));
          return;
        }
        resolve({ status: res.statusCode, body: body, url: url });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

function txt(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const URLS = [
  'https://gderabota.ru/вакансии/?text=python',
  'https://gderabota.ru/вакансии/',
  'https://gderabota.ru/вакансии/удаленная-работа/',
  'https://gderabota.ru/вакансии/удаленная-работа/?text=python',
];

(async function () {
  for (const u of URLS) {
    const r = await get(u);
    const t = txt(r.body);
    const vacLinks = [...new Set((r.body.match(/href="(\/вакансии\/[^"?#]+)"/g) || []).map((h) => h.slice(6, -1)))];
    const dates = [...new Set((t.match(/\d{1,2} [а-яё]+ 20\d\d/g) || []))];
    console.log('--- ' + u);
    console.log('    HTTP ' + r.status + ', ' + r.body.length + ' Б, итоговый адрес: ' + String(r.url).slice(0, 80));
    console.log('    ссылок на вакансии: ' + vacLinks.length + (vacLinks.length ? ' → ' + JSON.stringify(vacLinks.slice(0, 4)) : ''));
    console.log('    даты (' + dates.length + '): ' + (dates.slice(0, 6).join(', ') || 'нет'));
    console.log('    текст: ' + t.slice(0, 200));
    const pager = [...new Set((r.body.match(/page=\d+/g) || []))].slice(0, 6);
    if (pager.length) console.log('    пагинация: ' + JSON.stringify(pager));
    await new Promise((res) => setTimeout(res, 700));
  }
})();
