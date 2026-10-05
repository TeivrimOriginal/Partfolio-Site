// Считает тесты в TeivrimSite по содержимому файлов.
//
// Зачем считать самому. В письмах стоит «564 юнит-теста», и это число взято из
// комментария в ci.yml. Комментарий в том же репозитории — это тоже текст,
// написанный человеком, то есть ровно тот класс источника, который однажды уже
// оказался неточным. Пересчёт по исходникам стоит 30 секунд и снимает вопрос.
//
// Что показывает. Атрибуты в Rust размечены по-разному, поэтому простое число
// вхождений «test» бесполезно: считаются три вида по отдельности и складываются.
//
// Использование: node count-teivrimsite-tests.js
const { execFileSync } = require('child_process');

const GH = 'F:\\SUPPORT PROGRAMM\\gh.exe';
const REPO = 'TeivrimSite';
const REF = 'main';

function gh(args) {
  return execFileSync(GH, ['api', ...args, '-H', 'Accept: application/vnd.github.raw+json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const tree = JSON.parse(gh(['repos/TeivrimOriginal/' + REPO + '/git/trees/' + REF + '?recursive=1']));
const files = (tree.tree || [])
  .filter((x) => x.type === 'blob' && /^src\/.*\.rs$/i.test(x.path))
  .map((x) => x.path);

if (!files.length) {
  console.log('ПРОБЛЕМА: в src/ нет ни одного .rs — структура репозитория изменилась,');
  console.log('пересчёт невозможен, а заявленное число проверять нечем.');
  process.exit(1);
}

let plain = 0;
let tokio = 0;
let actix = 0;
let lines = 0;
const perFile = [];

for (const p of files) {
  const src = gh(['repos/TeivrimOriginal/' + REPO + '/contents/' + p + '?ref=' + REF]);
  const l = src.split('\n').length;
  lines += l;
  const a = (src.match(/#\[test\]/g) || []).length;
  const b = (src.match(/#\[tokio::test\]/g) || []).length;
  const c = (src.match(/#\[actix_web::test\]/g) || []).length;
  plain += a;
  tokio += b;
  actix += c;
  if (a + b + c) perFile.push(p.replace(/^src\//, '') + '=' + (a + b + c));
}

const total = plain + tokio + actix;

// Что заявляет сам репозиторий: комментарий в CI.
const ci = gh(['repos/TeivrimOriginal/' + REPO + '/contents/.github/workflows/ci.yml?ref=' + REF]);
const claim = ci.match(/There are (\d+) unit tests/);

console.log('репозиторий: ' + REPO);
console.log('файлов в src: ' + files.length + ', строк: ' + lines);
console.log('');
console.log('пересчитано по исходникам:');
console.log('  #[test]           ' + plain);
console.log('  #[tokio::test]    ' + tokio);
console.log('  #[actix_web::test] ' + actix);
console.log('  всего             ' + total);
console.log('');
console.log('по файлам: ' + perFile.join(', '));
console.log('');
if (claim) {
  const n = Number(claim[1]);
  console.log('в ci.yml заявлено: ' + n);
  if (n === total) {
    console.log('СОВПАДАЕТ — заявленное число подтверждено пересчётом.');
    process.exit(0);
  }
  console.log('НЕ СОВПАДАЕТ: пересчитано ' + total + ', заявлено ' + n + '.');
  console.log('Разница ' + (total - n) + '. Число в письмах надо ставить пересчитанное,');
  console.log('иначе в письме снова появится цифра, которую никто не считал.');
  process.exit(1);
}
console.log('в ci.yml числа тестов нет — сверять не с чем, но пересчёт выше и есть проверка.');
process.exit(0);