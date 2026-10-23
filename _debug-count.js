// Отладка: почему в count-all-tests.js не читались файлы.
// Временный скрипт, удаляется после разбора.
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

const reposRaw = JSON.parse(gh(['users/' + OWNER + '/repos?per_page=100']));
console.log('всего в ответе: ' + reposRaw.length);
const forks = reposRaw.filter((r) => r.fork).length;
console.log('форков: ' + forks);
const repos = reposRaw.filter((r) => !r.fork);
console.log('без форков: ' + repos.length);

const r = repos.find((x) => x.name === 'TeivrimSite');
console.log('TeivrimSite найден: ' + !!r + ', ветка: ' + (r && r.default_branch));

const tree = JSON.parse(gh(['repos/' + OWNER + '/TeivrimSite/git/trees/' + r.default_branch + '?recursive=1']));
console.log('элементов в дереве: ' + (tree.tree || []).length);

const blobs = (tree.tree || []).filter((x) => x.type === 'blob');
console.log('блобов: ' + blobs.length);

const byCode = blobs.filter((x) => CODE.test(x.path));
console.log('подходящих под CODE: ' + byCode.length);
console.log('примеры путей: ' + blobs.slice(0, 6).map((x) => x.path).join(' | '));

// Проверка регулярки отдельно на реальном пути.
const sample = blobs.find((x) => x.path.endsWith('.rs'));
console.log('образец: ' + JSON.stringify(sample && sample.path) + ' → CODE.test = ' + (sample ? CODE.test(sample.path) : 'нет образца'));

if (sample) {
  const arg = 'repos/' + OWNER + '/TeivrimSite/contents/' + sample.path;
  try {
    const s = gh([arg]);
    console.log('чтение по прямому аргументу: OK ' + s.length);
  } catch (e) {
    console.log('чтение по прямому аргументу: FAIL ' + String(e.stderr || e.message).slice(0, 90).replace(/\n/g, ' '));
  }
  const argRef = arg + '?ref=' + r.default_branch;
  try {
    const s = gh([argRef]);
    console.log('чтение с ?ref: OK ' + s.length);
  } catch (e) {
    console.log('чтение с ?ref: FAIL ' + String(e.stderr || e.message).slice(0, 90).replace(/\n/g, ' '));
  }
}