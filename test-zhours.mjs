// Тест разбора часов и меток совмещения. Проверяет на РЕАЛЬНЫХ строках
// из выборки hh (23 варианта поля «Рабочие часы»).
import { parseHours, studyMarks } from './zhours.mjs';

const CASES = [
  ['Рабочие часы: 4, 5 или 6', 4, 6],
  ['Рабочие часы: 4, 6, 8 или 12', 4, 12],
  ['Рабочие часы: 4, 5 или по договорённости', 4, 5],
  ['Рабочие часы: 8, 9, 10, 11 или 12', 8, 12],
  ['Рабочие часы: 8 или 10', 8, 10],
  ['Рабочие часы: 8', 8, 8],
  ['Рабочие часы: 12', 12, 12],
  ['Рабочие часы: 7 или 8', 7, 8],
  ['Рабочие часы: по договорённости', null, null],
  ['Рабочие часы: 24', null, null],
  ['Рабочие часы: Вечерние или ночные смены , 12', 12, 12],
  ['Рабочие часы: 8 и другие варианты', 8, 8],
  ['', null, null],
];

let fail = 0;
for (const [raw, min, max] of CASES) {
  const h = parseHours(raw);
  const ok = h.min === min && h.max === max;
  if (!ok) { console.log('FAIL', JSON.stringify(raw), '->', h.min, h.max, 'ожидалось', min, max); fail++; }
}

// Смены до 6 часов и до 8 часов должны находиться.
// В списке пять строк; «4, 6, 8 или 12» — это предложение на выбор, там
// минимальная смена 4 ч, но максимальная 12, поэтому в «до 8 ч» она не идёт
// (идёт в «есть смена от 4 ч»).
const short = ['Рабочие часы: 4, 5 или 6', 'Рабочие часы: 4, 6, 8 или 12', 'Рабочие часы: 4, 5 или по договорённости', 'Рабочие часы: 8', 'Рабочие часы: 12'];
const m6 = short.filter(x => (parseHours(x).max ?? 99) <= 6);
const m8 = short.filter(x => (parseHours(x).max ?? 99) <= 8);
if (m6.length !== 2) { console.log('FAIL: смен до 6 ч найдено', m6.length, 'ожидалось 2'); fail++; }
if (m8.length !== 3) { console.log('FAIL: смен до 8 ч найдено', m8.length, 'ожидалось 3'); fail++; }

// «4, 6, 8 или 12» — предложение на выбор, минимальная смена 4 ч
const choice = studyMarks({ hours: 'Рабочие часы: 4, 6, 8 или 12', schedule: '', desc: '', employmentType: '', title: '' });
if (!choice.join(' ').includes('есть смена от 4 ч')) { console.log('FAIL: нет метки «есть смена от 4 ч» |', choice.join(', ')); fail++; }

// Ночные смены и «по договорённости» должны помечаться
if (!parseHours('Рабочие часы: Вечерние или ночные смены , 12').night) { console.log('FAIL: ночные не помечены'); fail++; }
if (!parseHours('Рабочие часы: по договорённости').byDuty) { console.log('FAIL: по договорённости не помечено'); fail++; }

// Метки совмещения
const marks = studyMarks({ hours: 'Рабочие часы: 4, 5 или 6', schedule: 'График: 5/2', desc: 'Частичная занятость, подходит студентам', employmentType: '', title: '' });
for (const need of ['смена до 6 ч', 'частичная занятость', 'студент']) {
  if (!marks.join(' ').includes(need)) { console.log('FAIL: нет метки', need, '|', marks.join(', ')); fail++; }
}
const marks2 = studyMarks({ hours: 'Рабочие часы: 8', schedule: 'График: 2/2', desc: 'Подработка, гибкий график', employmentType: '', title: '' });
for (const need of ['смена 8 ч', 'сменный 2/2', 'подработка', 'свободный график']) {
  if (!marks2.join(' ').includes(need)) { console.log('FAIL: нет метки', need, '|', marks2.join(', ')); fail++; }
}

console.log(fail ? `ПРОВАЛЕНО проверок: ${fail}` : `все проверки пройдены (${CASES.length} разборов + 4 проверки меток)`);
process.exit(fail ? 1 : 0);
