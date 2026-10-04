// Откуда gorodrabot знает конечный адрес: ищем запрос в JS страницы /go.
//
// Зачем. Ни meta refresh, ни window.location, ни ссылки на hh в HTML страницы /go
// нет, а браузер из неё попадает на zarechny.hh.ru. Значит адрес приходит
// запросом к API. Если найти этот запрос, адреса можно разбирать из node, а не
// гонять браузер по 47 вакансиям.
//
// Использование: node probe-gorodrabot-go2.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 4) {
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

(async function () {
  const r = await get('https://gorodrabot.ru/go?id=1177838585&ent=1');
  const h = r.body;
  console.log('страница /go: HTTP ' + r.status + ', ' + h.length + ' Б');
  const scripts = [...new Set((h.match(/<script[^>]*src="([^"]+)"/g) || []).map((s) => s.match(/src="([^"]+)"/)[1]))];
  console.log('внешних скриптов: ' + scripts.length + ' → ' + JSON.stringify(scripts.slice(0, 8)));
  // Встроенные скрипты: ищем fetch/axios/XMLHttpRequest рядом с id/go.
  const inline = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((s) => /fetch|axios|XMLHttpRequest|location/.test(s));
  console.log('встроенных скриптов с запросами: ' + inline.length);
  inline.slice(0, 3).forEach((s, i) => {
    console.log('--- скрипт ' + (i + 1) + ' (фрагмент):');
    const lines = s.split('\n').map((x) => x.trim()).filter((x) => /fetch|axios|url|go|advert|redirect/i.test(x));
    console.log(lines.slice(0, 12).map((x) => '    ' + x.slice(0, 160)).join('\n'));
  });
  // Ищем в JSON-кусках страницы что-нибудь про источник.
  const jsonish = /"[^"]*(?:source|origin|url|redirect|target)[^"]*"\s*:\s*"[^"]{5,120}"/gi;
  const found = [...new Set((h.match(jsonish) || []))].slice(0, 12);
  console.log('JSON-поля с url/source: ' + JSON.stringify(found, null, 1));
})();
