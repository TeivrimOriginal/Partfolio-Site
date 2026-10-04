// Как gorodrabot перенаправляет на площадку: где в HTML лежит конечный адрес.
//
// Зачем. На /advert/... идёт редирект на /go?id=..., а уже оттуда браузер
// попадает на zarechny.hh.ru. Узел fetch отдаёт /go страницу в 20 КБ без
// полезного текста, значит конечный адрес зашит в разметке. Надо найти, чем
// он зашит: meta refresh, window.location или ссылка.
//
// Использование: node probe-gorodrabot-go.js
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
        resolve({ status: res.statusCode, body: body, url: url, chain: [url] });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

(async function () {
  const url = 'https://gorodrabot.ru/go?id=1177838585&ent=1&utm_source=remotejob&utm_medium=cpc&utm_campaign=hh';
  const r = await get(url);
  console.log('HTTP ' + r.status + ', ' + r.body.length + ' Б, итоговый URL: ' + String(r.url).slice(0, 120));

  const h = r.body;
  const patterns = [
    ['meta refresh', /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i],
    ['window.location', /location(?:\.href)?\s*=\s*["']([^"']+)["']/i],
    ['location.replace', /location\.replace\(\s*["']([^"']+)["']/i],
    ['a href на hh', /href="([^"]*hh\.ru[^"]*)"/i],
    ['любая ссылка на hh', /https?:\\?\/\\?\/[^"'\\\s]*hh\.ru[^"'\\\s]*/i],
    ['url= параметр', /[?&](?:url|redirect|to|link)=([^&"'\s]+)/i],
    ['data-url', /data-(?:url|href)=["']([^"']+)["']/i],
  ];
  for (const [name, re] of patterns) {
    const m = re.exec(h);
    console.log('  ' + (name + ':').padEnd(20) + (m ? m[1].slice(0, 120) : 'не найдено'));
  }
  console.log('');
  console.log('первые 1500 символов страницы:');
  console.log(h.slice(0, 1500).replace(/\s+/g, ' '));
})();
