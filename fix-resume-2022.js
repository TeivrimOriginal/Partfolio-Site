// Убирает недоказуемый год 2022 и слово «коммерческий» из новых резюме.
//
// Продолжение fix-resume-dates.js. Тот скрипт чинил 11 файлов, а потом
// параллельный цикл добавил ещё 30 специализированных резюме — с той же
// недоказуемой формулировкой, потому что они делались по старому образцу.
//
// Факты, из-за которых это нечестно, уже измерены и не изменились:
//
//   самый ранний публичный репозиторий   2024-10-26
//   первый Python                         2026-09-29
//   первый Rust                           2026-09-20
//   Kwork публичную дату не отдаёт (probe-kwork-date.js)
//
// Года 2022 нет нигде. Подставить 2024 тоже нельзя: это дата первого
// публичного репозитория, а не начало работы.
//
// Слово «коммерческий» убирается по той же причине, что и раньше: блок опыта на
// hh остаётся пустым, и «коммерческая разработка» в резюме противоречит тому,
// что он сам пишет в письмах.
//
// Скрипт идемпотентен и написан в расчёте на незнакомые формулировки: ищет год
// в любом контексте и заменяет предложение целиком, а не по заранее
// заготовленным строкам.
//
// Использование: node fix-resume-2022.js [--dry]
const fs = require('fs');
const path = require('path');

const DRY = process.argv.indexOf('--dry') >= 0;

const files = fs
  .readdirSync(__dirname)
  .filter((f) => /^resume.*\.html$/i.test(f))
  .sort();

let touched = 0;
let years = 0;
let commercial = 0;

for (const f of files) {
  const full = path.join(__dirname, f);
  let text = fs.readFileSync(full, 'utf8');
  const before = text;

  // 1. Год в любом виде: «с 2022 года», «по ТЗ заказчиков с 2022 года»,
  //    «коммерческие заказы с 2022 года плюс проекты». Убираем и год, и связку с
  //    ним: «заказы на Kwork с 2022 года» превращается в «заказы на Kwork».
  text = text.replace(
    /\s*(?:с|во)\s+2022\s*(?:года?|году)?/gi,
    ''
  );
  text = text.replace(
    /2022\s*(?:—|-|–)\s*(?:н\.?в\.?|Present|настоящее время)/gi,
    'по заказам на Kwork'
  );
  // Одиночный год в скобочной строке стека: «Python · 2022 — н.в.»
  text = text.replace(/(<span class="it-d mono">)([^<]*?)\s*2022\s*—\s*н\.?в\.?/gi, '$1$2 по заказам на Kwork');
  // Остатки: «(2022)», «— 2022», «2022 —»
  text = text.replace(/[(\[]\s*2022\s*[)\]]/g, '');
  text = text.replace(/(—|-|–)\s*2022\b/g, '');
  text = text.replace(/\b2022\b\s*—\s*н\.?в\.?/gi, 'по заказам на Kwork');

  // 2. Слово «коммерческий» в формулировках про работу.
  text = text.replace(
    /Python в коммерческой разработке/gi,
    'Python по заказам'
  );
  text = text.replace(
    /мой рабочий коммерческий язык/gi,
    'мой рабочий язык по заказам'
  );
  text = text.replace(
    /коммерческие заказы/gi,
    'заказы'
  );
  text = text.replace(
    /коммерческая разработка/gi,
    'разработка по заказам'
  );

  // 3. Двойные пробелы и пробелы перед знаками препинания, которые остались
  //    после удаления года.
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\s+([,.;:])/g, '$1');

  const nYears = (before.match(/\b2022\b/g) || []).length;
  const nComm = (before.match(/коммерческ/gi) || []).length;
  if (nYears) years += nYears;
  if (nComm) commercial += nComm;

  if (text !== before) {
    touched++;
    const left = (text.match(/\b2022\b/g) || []).length;
    const leftComm = (text.match(/коммерческ/gi) || []).length;
    console.log(
      (DRY ? 'было бы ' : 'правка  ') + f.padEnd(32) +
      'год: ' + nYears + ' → ' + left +
      ', коммерческ: ' + nComm + ' → ' + leftComm
    );
    if (!DRY) fs.writeFileSync(full, text, 'utf8');
  }
}

console.log('');
console.log('файлов: ' + files.length + ', изменено: ' + touched);
console.log('год 2022: ' + years + ' вхождений, слово «коммерческий»: ' + commercial);
if (DRY) console.log('это был прогон --dry: файлы не тронуты');
else if (years || commercial) console.log('проверь тестом: node test-resume-dates.js');
