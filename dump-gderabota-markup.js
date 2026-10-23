// Разметка карточки вакансии на главной gderabota.ru и параметры фильтров.
//
// Использование: node dump-gderabota-markup.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body }));
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

(async function () {
  const r = await get('https://gderabota.ru/?text=python');
  console.log('HTTP ' + r.status + ', ' + r.body.length + ' Б');
  const h = r.body;
  // Карточки: ищем повторяющийся контейнер со ссылкой на вакансию
  const shapes = {};
  const links = [...h.matchAll(/href="(\/вакансии\/[^"]+|\/vacancy\/\d+[^"]*)"/g)].map((m) => m[1]);
  const uniq = [...new Set(links)];
  console.log('ссылок на вакансии: ' + uniq.length);
  console.log('примеры: ' + JSON.stringify(uniq.slice(0, 6)));
  // Классы элементов, встречающихся рядом с первой ссылкой
  const at = h.indexOf(uniq[0] || 'нет');
  if (at > 0) {
    const chunk = h.slice(Math.max(0, at - 2500), at + 1200).replace(/\s+/g, ' ');
    console.log('--- фрагмент рядом с первой карточкой:');
    console.log(chunk.slice(0, 2200));
  }
  // Фильтры в разметке: что сайт умеет
  const filters = [...new Set((h.match(/[?&]([a-zA-Z_]+)=/g) || []))].slice(0, 20);
  console.log('--- параметры в ссылках: ' + JSON.stringify(filters));
  const remoteWords = /удаленн|удалённ|remote/i.test(h);
  console.log('--- есть слово «удалённо»: ' + remoteWords);
  const pager = [...new Set((h.match(/page=\d+/g) || []))].slice(0, 8);
  console.log('--- пагинация: ' + JSON.stringify(pager));
})();
