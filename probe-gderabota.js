// gderabota.ru: есть ли свежие junior-стажировки под наш стек.
//
// Зачем смотреть, а не откликаться сразу. Три найденные ранее вакансии датированы
// 15 июля 2026 и прямо в тексте say «старт 20 июля 2026» — к 5 октября стажировка
// уже началась. Отклик туда бессмыслен. Значит, нужен поиск по дате, а не отправка
// в найденное ранее.
//
// Использование: node probe-gderabota.js
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
    req.on('error', (e) => resolve({ status: 0, body: '', err: e.message }));
  });
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ').trim();
}

const SHAPES = [
  'https://gderabota.ru/search?text=python',
  'https://gderabota.ru/search?query=python',
  'https://gderabota.ru/?text=python',
  'https://gderabota.ru/vacancy/168272',
];

(async function () {
  for (const url of SHAPES) {
    const r = await get(url);
    const t = text(r.body);
    const links = [...new Set((r.body.match(/href="([^"]*vacancy[^"]*)"/g) || []).map((h) => h.slice(6, -1)))].slice(0, 6);
    const dates = [...new Set((t.match(/\d{1,2}\s+[а-яё]+\s+20\d\d/g) || []))].slice(0, 6);
    console.log('--- ' + url);
    console.log('    HTTP ' + r.status + ', ' + r.body.length + ' Б, итог ' + String(r.url).slice(0, 70));
    console.log('    текста: ' + t.length + ', начало: ' + t.slice(0, 130));
    console.log('    ссылки на вакансии: ' + (links.length ? JSON.stringify(links) : 'нет'));
    console.log('    даты: ' + (dates.length ? JSON.stringify(dates) : 'нет'));
    await new Promise((res) => setTimeout(res, 800));
  }
})();
