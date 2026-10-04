// Проверка фактов о backend-проекте по публичному репозиторию.
//
// Зачем. В письмах для backend стояло «три загрузчика внешних API с разными
// схемами ошибок: GraphQL, JSON:API и v1 JSON». В его резюме ни GraphQL, ни
// JSON:API не упоминаются — там «каталог из 3 публичных API». Названия протоколов
// появились сами, и подтвердить их было нечем. Проверяем репозиторий.
//
// Использование: node verify-backend-repo.js
const https = require('https');

const REPO = 'https://github.com/TeivrimOriginal/TeivrimSite';
const TERMS = ['GraphQL', 'graphql', 'json:api', 'jsonapi', 'anilist', 'kitsu',
  'shikimori', 'FTS5', 'fts5', 'sqlite', 'Actix', 'actix', 'Docker', 'docker',
  'pagination', 'пагинац', '20 000', '20000', 'unit', '564'];

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
    req.on('error', (e) => resolve({ code: 0, body: '', err: e.message }));
  });
}

(async function () {
  const r = await get(REPO);
  console.log('--- ' + REPO + ' -> HTTP ' + r.code + (r.err ? ' (' + r.err + ')' : '') + ', ' + r.body.length + ' Б');
  if (r.code !== 200) return;
  const hay = r.body.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const yes = [];
  const no = [];
  for (const t of TERMS) {
    const n = (hay.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
    (n > 0 ? yes : no).push(t + (n > 0 ? ' x' + n : ''));
  }
  console.log('  есть: ' + yes.join(', '));
  console.log('  нет:  ' + no.join(', '));
})();
