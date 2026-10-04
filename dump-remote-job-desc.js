// Где на странице вакансии remote-job.ru лежит описание: ищем ближайший
// контейнер по слову «требования» в любом регистре.
//
// Раньше поиск шёл по строке с большой буквы и не находил ничего, хотя слово в
// тексте есть — регистр у разметки чужой. Отсюда правило: искать без учёта
// регистра.
//
// Использование: node dump-remote-job-desc.js
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

(async function () {
  const list = await get('https://remote-job.ru/search?query=junior+python');
  const m = list.body.match(/\/vacancy\/show\/(\d+)\/([a-z0-9-]+)/);
  if (!m) { console.log('нет ссылок на вакансии'); return; }
  const url = 'https://remote-job.ru/vacancy/show/' + m[1] + '/' + m[2];
  const v = await get(url);
  console.log('вакансия ' + m[1] + ' → HTTP ' + v.status + ', ' + v.body.length + ' Б');

  const need = /требован|обязанност|опыт |описани|требования к/i;
  const at = v.body.search(need);
  console.log('первое совпадение по содержательным словам: позиция ' + at);
  if (at < 0) {
    console.log('фрагмент середины страницы: ' + v.body.slice(Math.floor(v.body.length / 2), Math.floor(v.body.length / 2) + 900).replace(/\s+/g, ' '));
    return;
  }
  // Идём назад по открывающим тегам, чтобы найти контейнер.
  let depth = 0;
  let i = at;
  let chunk = '';
  while (i > at - 6000 && i > 0) {
    if (v.body[i] === '>') depth++;
    if (v.body[i] === '<') {
      if (depth === 0) {
        const tagStart = v.body.lastIndexOf('<', i - 1);
        const tag = v.body.slice(tagStart, i + 1);
        if (/^<div|^<section|^<article|^<td/i.test(tag)) { chunk = tag; break; }
      } else depth--;
    }
    i--;
  }
  console.log('ближайший контейнер: ' + chunk.replace(/\s+/g, ' ').slice(0, 300));

  // Соберём текст от этого контейнера до следующего </div> того же уровня —
  // приблизительно, зато сразу видно, годится ли идея.
  console.log('--- текст после совпадения, 1400 символов ---');
  const seg = v.body.slice(at, at + 9000)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&times;/g, '×')
    .replace(/\s+/g, ' ')
    .trim();
  console.log(seg.slice(0, 1400));

  // Маркеры конца описания, чтобы отрезать подвал и «похожие вакансии».
  for (const end of ['Похожие вакансии', 'похожие вакансии', 'Откликнуться', 'Поделиться', 'footer', 'Оставить отзыв']) {
    console.log('  маркер «' + end + '» → позиция в тексте: ' + v.body.indexOf(end));
  }
})();
