// Считает факты прямо в публичных репозиториях, а не по снимкам.
//
// Зачем. Раньше доказательства брались из снимков save-evidence.js, а те
// снимки — это отрендеренная HTML-страница репозитория, то есть только то, что
// GitHub показывает на витрине. Из-за этого две правды были объявлены выдумкой:
//
//   * «GraphQL, JSON:API и v1 JSON» — есть в docs/ARCHITECTURE.md, но не в
//     README, поэтому поиск по снимку README их не нашёл;
//   * «разбор приватного ключа руками + тест, ловящий ошибки в ASN.1» — есть в
//     tools/rustore-upload.ps1 и tools/test-rustore-signing.ps1, и тест прямо
//     пишет, что поймал ошибку, но этих файлов на витрине нет.
//
// Второй вывод важнее первого: проверка искала не там. Метод был негодный, а
// из негодного метода следует выдумка — и наоборот, из отсутствия выдумки в
// письмах не следовало, что её нет в проекте. Потеряны были настоящие факты,
// которые отличают его от кандидата без единой строки в репозитории.
//
// Что делает скрипт. Обходит API GitHub по списку файлов репозитория и
// считает/ищет в содержимом: число тестовых функций, коммитов, вхождений
// терминов. Требует gh CLI, потому что api.github.com с машины отдаёт
// ECONNRESET, а gh работает.
//
// Использование: node verify-github-facts.js
const https = require('https');
const { execFileSync } = require('child_process');

const GH = 'F:\\SUPPORT PROGRAMM\\gh.exe';
const OWNER = 'TeivrimOriginal';

function gh(args) {
  const out = execFileSync(GH, ['api', ...args, '-H', 'Accept: application/vnd.github.raw+json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out;
}

function tree(repo, ref) {
  const t = JSON.parse(gh(['repos/' + OWNER + '/' + repo + '/git/trees/' + (ref || 'main') + '?recursive=1']));
  return (t.tree || []).filter((x) => x.type === 'blob').map((x) => x.path);
}

function blob(repo, path, ref) {
  return gh(['repos/' + OWNER + '/' + repo + '/contents/' + path + (ref ? '?ref=' + ref : '')]);
}

// Число коммитов из заголовка Link: rel="last".
function commitCount(repo) {
  const raw = execFileSync(GH, ['api', '-i', 'repos/' + OWNER + '/' + repo + '/commits?per_page=1'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const m = raw.match(/page=(\d+)>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

const results = [];
function check(name, actual, expected, ok) {
  results.push({ name, actual, expected, ok });
  console.log('  ' + (ok ? 'ок  ' : 'ПРОВАЛ') + '  ' + name);
  console.log('        получено: ' + actual);
  if (!ok) console.log('        ожидалось: ' + expected);
}

console.log('проверка фактов по публичным репозиториям ' + OWNER);
console.log('(счёт идёт по содержимому файлов, не по витрине GitHub)');
console.log('');

// ---------------------------------------------------------------- practice-automation-tests
console.log('practice-automation-tests — UI-автотесты');
{
  const files = tree('practice-automation-tests', 'main');
  const tests = files.filter((f) => /^tests\/.*\.py$/i.test(f));
  let fns = 0;
  const perFile = [];
  for (const f of tests) {
    const src = blob('practice-automation-tests', f);
    const n = (src.match(/^\s*def test_/gm) || []).length;
    fns += n;
    perFile.push(f + '=' + n);
  }
  console.log('  файлов тестов: ' + tests.length + ' (' + perFile.join(', ') + ')');
  // 47 заявлено в письмах и в резюме. Функций может быть меньше: параметризация
  // pytest даёт несколько тестов от одной функции, поэтому проверяем нижнюю
  // границу и отдельно сверяем заявленное число с README.
  check('функций test_ не меньше 40', fns, '>= 40', fns >= 40);
  const readme = blob('practice-automation-tests', 'README.md');
  const m = readme.match(/Всего\s+(\d+)\s+тест/);
  check('README заявляет 47', m ? m[1] : 'не найдено', '47', !!m && m[1] === '47');
  const parts = /(\d+)\s+позитивных\s+и\s+(\d+)\s+негативных.*?плюс\s+(\d+)/.exec(readme);
  check('разбивка 28+13+6 сходится к 47', parts ? parts[1] + '+' + parts[2] + '+' + parts[3] : 'не найдено',
    '28+13+6 = 47', !!parts && Number(parts[1]) + Number(parts[2]) + Number(parts[3]) === 47);
}

// ------------------------------------------------------------------------- Teivrim-Engine
console.log('');
console.log('Teivrim-Engine — игровой движок');
{
  const readme = blob('Teivrim-Engine', 'README.md');
  const n = commitCount('Teivrim-Engine');
  console.log('  коммитов: ' + n);
  check('коммитов не меньше 88', String(n), '>= 88', n !== null && n >= 88);
  for (const term of ['Vulkan', 'OpenGL', 'Assimp', 'scene graph', 'FBX', 'OBJ']) {
    check('README: ' + term, readme.toLowerCase().includes(term.toLowerCase()) ? 'есть' : 'нет', 'есть',
      readme.toLowerCase().includes(term.toLowerCase()));
  }
  const files = tree('Teivrim-Engine', 'main');
  const assimp = files.some((f) => /assimp/i.test(f));
  check('в дереве есть файлы Assimp', assimp ? 'да' : 'нет', 'да', assimp);
  check('в дереве есть импорт FBX/OBJ', /fbx|obj/i.test(files.join(' ')) ? 'да' : 'нет', 'да', /fbx|obj/i.test(files.join(' ')));
}

// ----------------------------------------------------------------------- TeivrimSite
console.log('');
console.log('TeivrimSite — каталог аниме на Actix-Web');
{
  const files = tree('TeivrimSite', 'main');

  // Названия протоколов. Раньше проверялись только по README витрины и были
  // объявлены выдумкой. На деле они в docs/ARCHITECTURE.md.
  const arch = blob('TeivrimSite', 'docs/ARCHITECTURE.md');
  for (const term of ['GraphQL', 'JSON:API', 'v1 JSON', 'WAL', 'unicode61', 'FTS5']) {
    check('ARCHITECTURE.md: ' + term, arch.includes(term) ? 'есть' : 'нет', 'есть', arch.includes(term));
  }
  check('docs/ARCHITECTURE.md в дереве репозитория', files.includes('docs/ARCHITECTURE.md') ? 'да' : 'нет', 'да',
    files.includes('docs/ARCHITECTURE.md'));

  // Три источника — по файлам загрузчиков, а не по словам в тексте.
  const loaders = files.filter((f) => /^src\/(loader|sources)\/.*\.rs$/i.test(f)).map((f) => f.toLowerCase());
  for (const src of ['anilist', 'kitsu', 'shikimori']) {
    check('файл загрузчика ' + src, loaders.some((f) => f.includes(src)) ? 'есть' : 'нет', 'есть',
      loaders.some((f) => f.includes(src)));
  }

  // WAL и пул соединений — по исходникам базы.
  const pool = blob('TeivrimSite', 'src/db/pool.rs');
  check('src/db/pool.rs: пул соединений', /Pool|pool/.test(pool) ? 'есть' : 'нет', 'есть', /Pool|pool/.test(pool));

  // RuStore: разбор приватного ключа руками и тест на этот разбор.
  const upload = blob('TeivrimSite', 'tools/rustore-upload.ps1');
  check('rustore-upload.ps1 разбирает DER вручную', /Read-DerLength/.test(upload) ? 'есть' : 'нет', 'есть',
    /Read-DerLength/.test(upload));
  check('rustore-upload.ps1: черновик и commit', /draft/i.test(upload) && /-Commit/.test(upload) ? 'есть' : 'нет', 'есть',
    /draft/i.test(upload) && /-Commit/.test(upload));

  const signing = blob('TeivrimSite', 'tools/test-rustore-signing.ps1');
  check('test-rustore-signing.ps1 существует и тестирует разбор', signing.length > 1000 ? 'да' : 'нет', 'да',
    signing.length > 1000);
  check('тест проверяет PKCS#1 и PKCS#8', /PKCS#1/.test(signing) && /PKCS#8/.test(signing) ? 'есть' : 'нет', 'есть',
    /PKCS#1/.test(signing) && /PKCS#8/.test(signing));
  check('тест сам пишет, что поймал ошибку', /It has already earned its place/i.test(signing) ? 'есть' : 'нет', 'есть',
    /It has already earned its place/i.test(signing));

  // CI: clippy с -D warnings, rustfmt, cargo test.
  const ci = blob('TeivrimSite', '.github/workflows/ci.yml');
  for (const term of ['clippy', '-D warnings', 'rustfmt', 'cargo test']) {
    check('ci.yml: ' + term, ci.includes(term) ? 'есть' : 'нет', 'есть', ci.includes(term));
  }

  // PowerShell 5.1 — скрипт должен работать и там.
  const rustore = blob('TeivrimSite', 'docs/RUSTORE.md');
  check('RUSTORE.md: PowerShell 5.1', rustore.includes('5.1') ? 'есть' : 'нет', 'есть', rustore.includes('5.1'));
}

// ---------------------------------------------------------------------- практика: числа
console.log('');
console.log('итоги');
const bad = results.filter((r) => !r.ok);
console.log('проверок: ' + results.length + ', провалов: ' + bad.length);
process.exit(bad.length === 0 ? 0 : 1);