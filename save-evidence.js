// Снимки доказательств: что сверялось, из какого репозитория и когда.
//
// Зачем хранить локально. Проверка test-proof-sources.js обязана работать без
// сети, а факты берутся из публичных репозиториев. raw.githubusercontent.com с
// машины рвёт соединение (ECONNRESET), зато работает gh CLI, поэтому файлы
// читаются через него.
//
// ГЛАВНОЕ, ради чего скрипт переписан. Раньше снимок брался со страницы
// репозитория на github.com — то есть только с витрины. Витрина показывает
// README и не показывает docs/ и tools/. Из-за этого две настоящие вещи были
// объявлены выдумкой и вычищены из писем:
//
//   * «GraphQL, JSON:API и v1 JSON» — есть в docs/ARCHITECTURE.md;
//   * «разбор приватного ключа руками и тест, ловящий ошибки» — есть в
//     tools/rustore-upload.ps1 и tools/test-rustore-signing.ps1, и тест прямо
//     пишет, какую ошибку поймал.
//
// Вывод, который стоит дороже самих фактов: из негодного метода проверки
// следует выдумка, и наоборот — отсутствие выдумки в письмах не доказывает, что
// её нет в проекте. Проверять надо содержимое файлов, а не витрину.
//
// Обновление: node save-evidence.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, 'evidence', 'github');
const GH = 'F:\\SUPPORT PROGRAMM\\gh.exe';
const OWNER = 'TeivrimOriginal';

// Снимки витрины оставлены: они показывают, что было видно с витрины, и нужны
// для сравнения «витрина против содержимого».
const PAGE_SOURCES = [
  {
    file: 'page-teivrimsite.txt',
    url: 'https://github.com/TeivrimOriginal/TeivrimSite',
    what: 'витрина TeivrimSite: только README, docs/ и tools/ отсюда не видны',
  },
  {
    file: 'page-teivrim-engine.txt',
    url: 'https://github.com/TeivrimOriginal/Teivrim-Engine',
    what: 'витрина Teivrim-Engine: графические бэкенды, scene graph, Assimp',
  },
];

// Настоящие файлы репозиториев. Именно они подтверждают письма.
const FILE_SOURCES = [
  { repo: 'TeivrimSite', ref: 'main', path: 'README.md', what: 'каталог аниме: три источника, SQLite FTS5, ~20 тыс. записей' },
  { repo: 'TeivrimSite', ref: 'main', path: 'docs/ARCHITECTURE.md', what: 'схема загрузчиков: GraphQL у AniList, JSON:API у Kitsu, v1 JSON у Shikimori; WAL и FTS5' },
  { repo: 'TeivrimSite', ref: 'main', path: 'docs/RUSTORE.md', what: 'выкладка в RuStore: черновик, commit, разбор ключа из DER вручную ради PowerShell 5.1' },
  { repo: 'TeivrimSite', ref: 'main', path: 'tools/rustore-upload.ps1', what: 'скрипт выкладки: ручной разбор DER, подпись, черновик, -Commit' },
  { repo: 'TeivrimSite', ref: 'main', path: 'tools/test-rustore-signing.ps1', what: 'тест разбора ключа: ловит ошибки ASN.1, поймал версию INTEGER до ветки PKCS#8' },
  { repo: 'TeivrimSite', ref: 'main', path: 'tools/test-favorites-patch.ps1', what: 'тест PATCH-семантики: serde схлопывает Option<Option<T>>' },
  { repo: 'TeivrimSite', ref: 'main', path: 'src/db/pool.rs', what: 'пул соединений SQLite и режим ожидания' },
  { repo: 'TeivrimSite', ref: 'main', path: '.github/workflows/ci.yml', what: 'CI: rustfmt, clippy -D warnings, cargo test' },
  { repo: 'Teivrim-Engine', ref: 'main', path: 'README.md', what: 'движок: Vulkan и OpenGL, scene graph, Assimp, FBX и OBJ' },
  { repo: 'practice-automation-tests', ref: 'main', path: 'README.md', what: '47 UI-автотестов: 28 позитивных, 13 негативных, 6 на форму' },
  { repo: 'practice-automation-tests', ref: 'main', path: '.github/workflows/tests.yml', what: 'CI автотестов на Selenium и Pytest' },
  { repo: 'Copy-SAI-Paint-with-Rust', ref: 'main', path: '.github/workflows/ci.yml', what: 'CI редактора: rustfmt, clippy, тесты' },
  { repo: 'teivrim-novell-engine', ref: 'master', path: 'README.md', what: 'движок визуальных новелл на C++ с Win32 и GDI+' },
  { repo: 'IT-Hack-Project-TEIVRIM-social-messendjer', ref: 'main', path: 'README.md', what: 'мессенджер на хакатоне: socket.io, WebSocket, загрузка файлов' },
  { repo: 'anime-sync-api', ref: 'main', path: 'README.md', what: 'FastAPI и PostgreSQL: tsvector, GIN, миграции Alembic' },
  { repo: '1c-simple-accounting', ref: 'main', path: 'README.md', what: 'конфигурация 1С: справочники, регистры накопления, BSL' },
];

function localName(repo, p) {
  return repo + '.' + p.replace(/[\\/]/g, '-');
}

function ghFile(repo, ref, p) {
  return execFileSync(GH, ['api', 'repos/' + OWNER + '/' + repo + '/contents/' + p + '?ref=' + ref,
    '-H', 'Accept: application/vnd.github.raw+json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

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
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&middot;/g, '·').replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/\s+/g, ' ')
    .trim();
}

(async function () {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  let failed = 0;
  let written = 0;

  // 1. Содержимое файлов — то, чем подтверждаются письма.
  for (const src of FILE_SOURCES) {
    let raw;
    try {
      raw = ghFile(src.repo, src.ref, src.path);
    } catch (e) {
      console.log('НЕ ПРОЧИТАЛОСЬ ' + src.repo + '/' + src.path + ' — ' + (e && e.message ? e.message.slice(0, 80) : 'ошибка'));
      failed++;
      continue;
    }
    const header = [
      'ДОКАЗАТЕЛЬСТВО. Не выдумывать содержимое этого файла.',
      'Источник: https://github.com/' + OWNER + '/' + src.repo + '/blob/' + src.ref + '/' + src.path,
      'Что сверялось: ' + src.what,
      'Снято: ' + today,
      'Символов: ' + raw.length,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT_DIR, localName(src.repo, src.path)), header + raw, 'utf8');
    written++;
    console.log('записано evidence/github/' + localName(src.repo, src.path) + ' (' + raw.length + ' симв.) ← ' + src.repo + '/' + src.path);
  }

  // 2. Витрина — для сравнения, что было видно снаружи.
  for (const src of PAGE_SOURCES) {
    const r = await get(src.url);
    if (r.code !== 200) {
      console.log('витрина не скачалась ' + src.url + ' -> HTTP ' + r.code);
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
    fs.writeFileSync(path.join(OUT_DIR, src.file), header + text, 'utf8');
    written++;
    console.log('записано evidence/github/' + src.file + ' (' + text.length + ' симв.)');
  }

  console.log('');
  console.log('записано снимков: ' + written + ', не получилось: ' + failed);
  console.log('поля писем ссылаются на эти файлы: evidence/github/…');
  process.exit(failed ? 1 : 0);
})();