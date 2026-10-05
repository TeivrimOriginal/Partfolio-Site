// Печать фрагментов файлов TeivrimSite вокруг ключевых слов.
//
// Зачем. Формулировка в письме должна совпадать с тем, что репозиторий
// действительно описывает, иначе это выдумка.
//
// ВАЖНО, что здесь было испорчено. Скрипт читал витрину github.com, то есть
// только README. Из этого следовал вывод «слов GraphQL и JSON:API в
// репозитории нет, значит названия протоколов появились сами» — и вывод был
// неверен: эти слова есть в docs/ARCHITECTURE.md, который витрина не
// показывает. Ложный вывод удалил из писем настоящие факты.
//
// Теперь читаются реальные файлы через gh CLI: README, docs/, tools/, src/,
// .github/. Список файлов — по дереву репозитория, то есть целиком.
//
// Использование: node read-teivrimsite-readme.js
const { execFileSync } = require('child_process');

const GH = 'F:\\SUPPORT PROGRAMM\\gh.exe';
const REPO = 'TeivrimSite';

const WORDS = [
  'AniList', 'Kitsu', 'Shikimori',
  // Названия протоколов — именно их поиск не нашёл на витрине.
  'GraphQL', 'JSON:API', 'v1 JSON',
  'FTS5', 'WAL', 'unicode61',
  'ошибк', 'лимит', 'пагинац',
  // RuStore: разбор ключа и тест на него.
  'DER', 'ASN.1', 'черновик', '5.1',
  // CI.
  'clippy', 'rustfmt',
];

function gh(args) {
  return execFileSync(GH, ['api', ...args, '-H', 'Accept: application/vnd.github.raw+json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

const tree = JSON.parse(gh(['repos/TeivrimOriginal/' + REPO + '/git/trees/main?recursive=1']));
// Текстовые файлы, которые стоит прочесть: README, документация, скрипты,
// исходники и CI. Картинки и бинарные пропускаем.
const files = (tree.tree || [])
  .filter((x) => x.type === 'blob')
  .map((x) => x.path)
  .filter((p) => /\.(md|rs|ps1|yml|yaml|toml|json|kts)$/i.test(p));

console.log('репозиторий: TeivrimOriginal/' + REPO);
console.log('файлов в дереве: ' + (tree.tree || []).length + ', текстовых разбираю: ' + files.length);
console.log('слов: ' + WORDS.length);
console.log('');

for (const p of files) {
  let src;
  try {
    src = gh(['repos/TeivrimOriginal/' + REPO + '/contents/' + p]);
  } catch (e) {
    console.log('  ! не прочитан ' + p);
    continue;
  }
  const low = src.toLowerCase();
  for (const w of WORDS) {
    const i = low.indexOf(w.toLowerCase());
    if (i < 0) continue;
    const line = src.slice(0, i).split('\n').length;
    const from = Math.max(0, i - 120);
    console.log('[' + w + '] ' + p + ':' + line);
    console.log('    …' + src.slice(from, i + 180).replace(/\s+/g, ' ').trim() + '…');
    console.log('');
  }
}