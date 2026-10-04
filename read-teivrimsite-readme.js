// Печать фрагментов README TeivrimSite вокруг ключевых слов, чтобы формулировка
// в письме совпадала с тем, что репозиторий действительно описывает.
//
// Зачем. «Три загрузчика с разными схемами ошибок: GraphQL, JSON:API и v1 JSON»
// не подтвердилось: в репозитории есть AniList, Kitsu и Shikimori, но слов GraphQL
// и JSON:API там нет. Прежде чем писать новое утверждение, смотрю исходный текст.
//
// Использование: node read-teivrimsite-readme.js
const https = require('https');

const URL = 'https://github.com/TeivrimOriginal/TeivrimSite';
const WORDS = ['AniList', 'Kitsu', 'Shikimori', 'ошибк', 'лимит', 'пагинац', 'FTS5'];

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ code: res.statusCode, body: body }));
    });
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: 0, body: '' }); });
    req.on('error', () => resolve({ code: 0, body: '' }));
  });
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&middot;/g, '·').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

(async function () {
  const r = await get(URL);
  if (r.code !== 200) { console.log('HTTP ' + r.code); return; }
  const t = text(r.body);
  for (const w of WORDS) {
    const i = t.toLowerCase().indexOf(w.toLowerCase());
    if (i < 0) { console.log('[' + w + '] не найдено'); continue; }
    const from = Math.max(0, i - 130);
    console.log('[' + w + '] …' + t.slice(from, i + 190).trim() + '…');
    console.log('');
  }
})();
