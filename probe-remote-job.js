// Разведка remote-job.ru: разметка карточек, пагинация, где лежит описание.
//
// Зачем эта доска: hh отдал 127 откликов и пул исчерпан, на Хабр Карьере после
// всех фильтров осталось 4 вакансии. Сбор вакансий не требует входа, поэтому
// новый канал можно открыть, пока отклики ждут логина.
//
// Использование: node probe-remote-job.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9', Accept: 'text/html' },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 4) {
          resolve(get(new URL(loc, url).href, depth + 1));
          return;
        }
        resolve({ status: res.statusCode, body: body, type: (res.headers['content-type'] || '') });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

(async function () {
  // 1. Сколько вакансий на странице поиска и как устроена пагинация.
  const search = await get('https://remote-job.ru/search?query=python');
  console.log('поиск python → HTTP ' + search.status + ', ' + search.body.length + ' Б');
  const ids = [...new Set((search.body.match(/\/vacancy\/show\/(\d+)/g) || []).map((s) => s.split('/').pop()))];
  console.log('уникальных вакансий на странице: ' + ids.length);
  const pages = [...new Set((search.body.match(/[?&](page|page_number|p)=(\d+)/g) || []))].slice(0, 8);
  console.log('пагинация: ' + JSON.stringify(pages));

  // 2. Разметка первой карточки: какие классы и что внутри.
  const cardIdx = search.body.indexOf('/vacancy/show/');
  if (cardIdx > 0) {
    const start = search.body.lastIndexOf('<', cardIdx - 400 > 0 ? cardIdx - 400 : 0);
    console.log('--- фрагмент разметки рядом с первой карточкой:');
    console.log(search.body.slice(Math.max(0, cardIdx - 900), cardIdx + 700).replace(/\s+/g, ' ').slice(0, 1500));
  }

  // 3. Страница одной вакансии: где описание и есть ли требования.
  if (ids.length) {
    const v = await get('https://remote-job.ru/vacancy/show/' + ids[0]);
    console.log('--- вакансия ' + ids[0] + ' → HTTP ' + v.status + ', ' + v.body.length + ' Б');
    const body = text(v.body);
    console.log('текст вакансии (начало): ' + body.slice(0, 700));
    console.log('есть «Опыт»: ' + /опыт/i.test(body) + ', «Требования»: ' + /требован/i.test(body) + ', «Обязанности»: ' + /обязанност/i.test(body));
  }

  // 4. Сколько отдаёт другой запрос — узкий, чтобы понять пагинацию и глубину.
  for (const q of ['стажер', 'junior python', 'тестировщик']) {
    const r = await get('https://remote-job.ru/search?query=' + encodeURIComponent(q));
    const n = [...new Set((r.body.match(/\/vacancy\/show\/(\d+)/g) || []).map((s) => s.split('/').pop()))].length;
    console.log('запрос «' + q + '» → HTTP ' + r.status + ', вакансий на странице: ' + n);
  }
})();
