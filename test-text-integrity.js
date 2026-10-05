// Ищет замещающий символ U+FFFD (�) в текстовых файлах репозитория.
//
// Зачем. В hsw-app.ps1 он появился сам, при записи через инструмент правки:
// строка «ЗАДАЁТСЯ» превратилась в «ЗАДА�ТСЯ». Символ выглядит как
// безобидный квадратик и молча ломает текст — комментарий в этом случае
// врёт, а код остаётся рабочим, поэтому ошибка доживает до пользователя.
//
// Что ищется:
//   U+FFFD — замещающий символ, признак битых байтов при декодировании;
//   одиночные «битые» последовательности вида тХтг¬┐ (кириллица в OEM);
//   NUL-байты — уже всплывали в hsw-db.js.
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// Исключения по каталогам. Первый прогон дал 2416 вхождений, и подавляющее
// большинство оказалось мусором: .ruff_cache и .coverage внутри чужих проектов
// PROJECTFASTAPI/PROJECTSOCIAL — это бинарные файлы, которые вовсе не текст.
// Считать их «битым текстом» нельзя: проверка, которая ругается на чужие
// кэши, перестаёт читаться и её выключают целиком.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'evidence', '__pycache__',
  '.ruff_cache', '.pytest_cache', '.mypy_cache', 'venv', '.venv',
  'PROJECTFASTAPI', 'PROJECTSOCIAL',
]);

// Расширения. Пустое расширение пропускается: безымянные и служебные файлы
// не имеют смысла проверять как текст.
const EXT = new Set(['.js', '.ps1', '.md', '.json', '.csv', '.html', '.txt', '.cmd', '.xml', '.yml', '.yaml']);

// Временные и диагностические файлы: по определению содержат вывод программ
// в OEM-кодировке, и «битые символы» в них — ожидаемость, а не дефект.
const SKIP_FILES = /^(hsw-|_probe|hsw-dbg|hsw-err|hsw-out|_enc-fresh|_shot)/;

// Сам тест не должен попадать в отчёт: в нём U+FFFD написан намеренно, как
// образец того, что ищется. Иначе проверка всегда находит саму себя.
const SELF = path.basename(__filename);

// OEM-мусор: кириллица, разобранная как cp866/cp437. Ищем не по алфавиту, а по
// признаку — подряд идущие символы U+00xx вперемешку с псевдографикой, чего
// в нормальном русском тексте не бывает.
const OEM_NOISE = /[\u00C0-\u00FF]{2,}[\u2500-\u259F]/;

// НАМЕРЕННОЕ УПОМИНАНИЕ. Символ «�» внутри строки, где он записан как
// ОБРАЗЕЦ самого себя — в кавычках или в обратных кавычках: «ловится поиском
// по `�`», «Select-String -Pattern '�'», «битые символы `·` → `�`».
// Такие строки есть в NOTES.md и github-audit.md, и правки они не требуют.
//
// Правило точное, а не «если в строке есть слово "поиск"»: каждое вхождение
// «�» должно лежать внутри пары кавычек или backticks. Строка с «�» посреди
// слова правилу не удовлетворяет — там настоящая поломка.
//
// Почему разделение обязательно. Первая версия проверки считала любое
// вхождение ошибкой и давала 78 срабатываний, из которых часть была
// инструкцией самой проверки. Если проверка ругается на документацию о себе,
// её выключают — и тогда она перестаёт ловить настоящее.
function countRealBreaks(line) {
  // Вырезаем всё, что стоит в кавычках или backticks.
  const stripped = line
    .replace(/`[^`]*`/g, '')
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '');
  const all = (line.match(/�/g) || []).length;
  const left = (stripped.match(/�/g) || []).length;
  return { all, inQuotes: all - left, real: left };
}

let filesScanned = 0;
const problems = [];
const mentions = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(full);
      continue;
    }
    const rel = path.relative(ROOT, full);
    if (rel === SELF) continue;
    if (SKIP_FILES.test(ent.name)) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!EXT.has(ext)) continue;
    filesScanned++;
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch (e) {
      continue;
    }

    const nulIdx = buf.indexOf(0);
    if (nulIdx >= 0) problems.push({ file: rel, kind: 'NUL-байт', detail: 'позиция ' + nulIdx });

    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf('\uFFFD') >= 0) {
        const item = { file: rel, kind: 'U+FFFD', line: i + 1, detail: line.trim().slice(0, 90) };
        // Упоминанием считается строка, где ВСЕ вхождения «�» стоят внутри
        // кавычек или backticks. Если хоть одно лежит посреди текста — это
        // поломка, даже если в строке есть слово «поиск».
        if (countRealBreaks(line).real === 0) mentions.push(item);
        else problems.push(item);
      }
      // BOM в середине файла — признак склейки двух записей
      if (line.indexOf('\uFEFF') >= 0 && i > 0) {
        problems.push({ file: rel, kind: 'BOM в середине', line: i + 1, detail: line.trim().slice(0, 60) });
      }
      if (OEM_NOISE.test(line)) {
        problems.push({ file: rel, kind: 'OEM-мусор', line: i + 1, detail: line.trim().slice(0, 90) });
      }
    }
  }
}

walk(ROOT);

console.log('файлов проверено: ' + filesScanned);
console.log('поломок найдено:  ' + problems.length);
console.log('упоминаний (не ошибка): ' + mentions.length);
if (mentions.length) {
  const mf = new Set(mentions.map((m) => m.file));
  console.log('  в файлах: ' + [...mf].join(', '));
}
if (problems.length) {
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const [file, list] of byFile) {
    console.log('\n' + file + '  (' + list.length + ')');
    for (const p of list.slice(0, 6)) {
      console.log('  ' + p.kind + (p.line ? ' строка ' + p.line : '') + '  ' + p.detail);
    }
    if (list.length > 6) console.log('  ... ещё ' + (list.length - 6));
  }
  process.exitCode = 1;
} else {
  console.log('\nбитых символов нет');
}