// Есть ли в HTML страницы объявления gorodrabot конечный адрес площадки.
//
// Зачем. redirect.js выполняет переход скриптом, из node адрес не достать. Если
// он лежит в разметке объявления — обходимся без браузера. Если нет, придётся
// разбирать адреса браузером.
//
// Использование: node probe-gorodrabot-advert.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

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

const PATTERNS = [
  ['vacancy/<id>', /vacancy\/(\d{6,12})/g],
  ['hh.ru url', /https?:\\?\/\\?\/[^"'\\\s]*hh\.ru[^"'\\\s]*/gi],
  ['headhunter', /headhunter/gi],
  ['source_url', /source[_-]?url[^,]{0,140}/gi],
  ['origin', /origin[a-z_]*[^,]{0,140}/gi],
  ['data-url', /data-url="([^"]+)"/gi],
  ['go?id=', /go\?id=\d+/gi],
  ['redirect_url', /redirect[a-z_]*url[^,]{0,140}/gi],
  ['vacancy_id', /vacancy_id["':=\s]+(\d{6,12})/gi],
];

(async function () {
  const r = await get('https://gorodrabot.ru/advert/1177838585/x');
  console.log('HTTP ' + r.status + ', ' + r.body.length + ' Б');
  const h = r.body;
  for (const [name, re] of PATTERNS) {
    const m = [...new Set((h.match(re) || []))].slice(0, 5);
    console.log('  ' + name.padEnd(13) + ': ' + (m.length ? JSON.stringify(m).slice(0, 400) : 'нет'));
  }
})();
