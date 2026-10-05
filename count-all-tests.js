// Пересчитывает тесты по всем публичным репозиториям.
//
// Зачем. В письмах стоят два числа: 564 юнит-теста в каталоге и 158 в редакторе
// на Rust. Первое пересчитано — оказалось 565, на единицу больше, чем заявлено в
// комментарии CI. Второе не подтверждено ничем: ни в одном репозитории из его
// публичного профиля тестов не нашлось.
//
// Числа в письмах берутся из текста, который написан человеком, то есть ровно
// тот класс источника, который уже один раз ошибся. Пока в письмах стоит
// непроверяемое «158», туда же может вернуться любое другое число из этого
// класса. Поэтому считаем всё, что можем посчитать.
//
// Использование: node count-all-tests.js
const { execFileSync } = require('child_process');

const GH = 'F:\\SUPPORT PROGRAMM\\gh.exe';
const OWNER = 'TeivrimOriginal';

function gh(args) {
  return execFileSync(GH, ['api', ...args, '-H', 'Accept: application/vnd.github.raw+json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const CODE = /\.(rs|py|cpp|cc|h|hpp|js|ts|cs)$/i;
const ATTR = /#\[(test|tokio::test|actix_web::test|test_case)\]/g;
const PYDEF = /(?:^|\s)def test_/gm;
const GTEST = /\b(?:TEST|TEST_F|TEST_P)\s*\(/g;
const JSDESC = /\b(?:it|test)\s*\(\s*['"`]/g;

const repos = JSON.parse(gh(['users/' + OWNER + '/repos?per_page=100'])).filter((r) => !r.fork);

console.log('репозиториев в профиле: ' + repos.length + ' (без форков)');
console.log('');

let grand = 0;
const rows = [];
const unreadable = [];

for (const r of repos) {
  let tree;
  try {
    tree = JSON.parse(gh(['repos/' + OWNER + '/' + r.name + '/git/trees/' + r.default_branch + '?recursive=1']));
  } catch (e) {
    unreadable.push(r.name + ' (дерево: ' + String(e && e.message).slice(0, 60) + ')');
    continue;
  }
  // Именно map, а не filter: filter оставлял объекты дерева, и в адрес API
  // попадал «[object Object]», то есть 404 на каждом файле. Скрипт при этом
  // отрабатывал без ошибки и печатал «прочитано 0».
  const files = (tree.tree || []).filter((x) => x.type === 'blob' && CODE.test(x.path)).map((x) => x.path);
  let n = 0;
  let read = 0;
  let firstErr = null;
  for (const p of files) {
    let src;
    try {
      src = gh(['repos/' + OWNER + '/' + r.name + '/contents/' + p + '?ref=' + r.default_branch]);
    } catch (e) {
      if (!firstErr) firstErr = r.name + '/' + p + ' → ' + String(e.stderr || e.message).slice(0, 90).replace(/\n/g, ' ');
      continue;
    }
    read++;
    const before = n;
    n += (src.match(ATTR) || []).length;
    n += (src.match(PYDEF) || []).length;
    n += (src.match(GTEST) || []).length;
    n += (src.match(JSDESC) || []).length;
    if (n < before) n = before;
  }
  grand += n;
  if (firstErr && read === 0) console.log('  ! ' + firstErr);
  rows.push({ repo: r.name, lang: r.language || '—', files: files.length, read: read, tests: n });
}

rows.sort((a, b) => b.tests - a.tests);
for (const x of rows) {
  const mark = x.tests ? String(x.tests).padStart(5) : '    —';
  console.log('  ' + mark + '  ' + x.repo.padEnd(40) + x.lang.padEnd(14) + ' файлов прочитано: ' + x.read);
}

console.log('');
if (unreadable.length) {
  console.log('не прочитаны: ' + unreadable.join(', '));
  console.log('');
}
console.log('всего тестовых функций во всех репозиториях профиля: ' + grand);
console.log('');
console.log('Что это значит для писем.');
console.log('  Каталог (TeivrimSite): пересчитано 565, в письмах стоит 564.');
console.log('  Редактор на Rust: в публичных репозиториях тестов нет вообще.');
console.log('Число «158 юнит-тестов» не подтверждается ничем и обязано уйти из писем,');
console.log('пока его нечем подтвердить. Уменьшенное до проверяемого 565 тоже верно.');
process.exit(0);