// Снимки доказательств: что именно сверялось, из какого репозитория и когда.
//
// Зачем хранить локально. Проверка test-proof-sources.js обязана быть быстрой и
// работать без сети, но факты берутся из публичных репозиториев, которые с
// машины меня не отдают через raw.githubusercontent.com. Поэтому страница
// репозитория выкачивается один раз, из неё вытаскивается текст README и
// кладётся сюда. Дальше цитата в письме проверяется по этому файлу.
//
// Обновление: node save-evidence.js
//
// Оговорка про честность снимка: он хранит то, что было на странице на дату
// файла. Заголовок с датой обязателен — без него снимок неотличим от выдумки.
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, 'evidence');

const SOURCES = [
  {
    file: 'teivrimsite-readme.txt',
    url: 'https://github.com/TeivrimOriginal/TeivrimSite',
    what: 'Anime DB: три внешних источника, JSON API, лимиты, единый вид ошибок',
  },
  {
    file: 'teivrim-engine-readme.txt',
    url: 'https://github.com/TeivrimOriginal/Teivrim-Engine',
    what: 'Teivrim-Engine: графические бэкенды, scene graph, Assimp',
  },
  {
    file: 'teivrimsite-files.txt',
    url: 'https://github.com/TeivrimOriginal/TeivrimSite/tree/main',
    what: 'Состав репозитория Anime DB: сколько тестов, есть ли Dockerfile',
  },
];

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

function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&middot;/g, '·').replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ')
    .trim();
}

(async function () {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  let failed = 0;
  for (const src of SOURCES) {
    const r = await get(src.url);
    if (r.code !== 200) {
      console.log('НЕ СКАЧАЛОСЬ ' + src.url + ' -> HTTP ' + r.code + (r.err ? ' (' + r.err + ')' : ''));
      failed++;
      continue;
    }
    const text = toText(r.body);
    const header = [
      'ДОКАЗАТЕЛЬСТВО. Не выдумывать содержимое этого файла.',
      'Источник: ' + src.url,
      'Что сверялось: ' + src.what,
      'Снято: ' + today,
      'HTTP: ' + r.code + ', байт HTML: ' + r.body.length + ', символов текста: ' + text.length,
      '',
    ].join('\n');
    const out = path.join(OUT_DIR, src.file);
    fs.writeFileSync(out, header + text, 'utf8');
    console.log('записано ' + path.relative(__dirname, out) + ' (' + text.length + ' символов) ← ' + src.url);
  }
  console.log(failed ? 'не скачалось источников: ' + failed : 'все источники скачаны');
  process.exit(failed ? 1 : 0);
})();
