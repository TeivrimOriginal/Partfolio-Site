// Пагинация remote-job.ru: как получить вторую и третью страницу.
//
// Зачем. На странице поиска ровно 20 вакансий при любом запросе, а ссылок
// пагинации в HTML нет — значит либо подгрузка скриптом, либо другой параметр.
// Без этого нельзя собрать пул больше 20 вакансий на запрос.
//
// Использование: node probe-remote-job-pages.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body, type: res.headers['content-type'] || '' }));
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

const idsOf = (body) => [...new Set((body.match(/\/vacancy\/show\/(\d+)/g) || []).map((s) => s.split('/').pop()))];

(async function () {
  const base = await get('https://remote-job.ru/search?query=python');
  const baseIds = idsOf(base.body);
  console.log('базовая страница: ' + baseIds.length + ' вакансий, первые id: ' + baseIds.slice(0, 3).join(','));

  const variants = [
    'query=python&page=2',
    'query=python&p=2',
    'query=python&page_number=2',
    'query=python&offset=20',
    'query=python&start=20',
    'query=python&page%5Bnumber%5D=2',
  ];
  for (const v of variants) {
    const r = await get('https://remote-job.ru/search?' + v);
    const ids = idsOf(r.body);
    const same = ids.filter((id) => baseIds.indexOf(id) >= 0).length;
    console.log('  ' + v.padEnd(34) + ' HTTP ' + r.status + ', вакансий ' + ids.length + ', совпало с первой страницей: ' + same);
  }

  // Подгрузка скриптом: ищем следы ajax-эндпоинта в HTML и в подключённых js.
  const html = base.body;
  const hints = [...new Set((html.match(/["'](\/[a-z0-9_\-\/]*(?:ajax|api|load|more|vacan)[a-z0-9_\-\/]*)["']/gi) || []))].slice(0, 12);
  console.log('похожие на эндпоинты строки в HTML: ' + JSON.stringify(hints));
  const jsUrls = [...new Set((html.match(/src="([^"]+\.js[^"]*)"/g) || []).map((s) => s.slice(5, -1)))].slice(0, 8);
  console.log('js-файлов на странице: ' + jsUrls.length);
  for (const u of jsUrls.slice(0, 5)) {
    const abs = u.indexOf('http') === 0 ? u : 'https://remote-job.ru' + (u.indexOf('/') === 0 ? u : '/' + u);
    const j = await get(abs);
    if (j.status !== 200) { console.log('  ' + u.slice(0, 50) + ' → HTTP ' + j.status); continue; }
    const eps = [...new Set((j.body.match(/["'](\/[a-z0-9_\-\/]*(?:ajax|api|load-?more|more)[a-z0-9_\-\/]*)["']/gi) || []))].slice(0, 6);
    const pageWords = [...new Set((j.body.match(/(page_number|pageNumber|start=|offset=|\?page)/g) || []))].slice(0, 6);
    console.log('  ' + u.split('/').pop().slice(0, 40) + ' → эндпоинты ' + JSON.stringify(eps) + ', параметры ' + JSON.stringify(pageWords));
  }
})();
