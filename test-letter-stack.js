// Письмо должно говорить о том же стеке, что и прикреплённое резюме.
//
// Зачем. У него девять версий резюме под разные вакансии, а hh к отклику
// прикрепляет одно. Если письмо начинается «Junior QA-инженер», а к отклику
// приложено резюме «Junior Python-разработчик», рекрутер видит расхождение и
// относится к письму как к шаблону. Раньше все письма начинались одной строкой
// про Python и C++, независимо от вакансии.
//
// Проверяется ровно то, что уйдёт в hh: LETTERS-SHORTLIST.json.
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('LETTERS-SHORTLIST.json', 'utf8'));
const { STACKS, stackFor, profileFor, DEFAULT_STACK } = require('./hh-resume-stack.js');
const { sameFact } = require('./hh-letter.js');

let bad = 0;
const byStack = {};

for (const r of rows) {
  if (!r.stack) {
    console.log('  ' + r.id + ': не указан стек письма');
    bad++;
    continue;
  }
  const profile = profileFor(r.stack);
  byStack[r.stack] = (byStack[r.stack] || 0) + 1;

  // 1. Вступление соответствует стеку.
  if (r.letter.indexOf(profile.intro) < 0) {
    console.log('  ' + r.id + ' (' + r.stack + '): вступление не от стека');
    bad++;
  }
  // 2. Письмо называет прикреплённое резюме.
  if (r.resume && r.letter.indexOf('«' + r.resume + '»') < 0) {
    console.log('  ' + r.id + ' (' + r.stack + '): не названо резюме «' + r.resume + '»');
    bad++;
  }
  // 3. Письмо не утверждает, что прикреплено чужое резюме.
  // Проверяется только строка «Резюме, которое прикреплено…»: заголовок вакансии
  // цитируется в обращении, и «Junior Backend-разработчик» в тексте письма — это
  // название вакансии, а не ошибка в выборе резюме.
  const attachedLine = r.letter.split('\n').find((l) => /^Резюме, которое прикреплено/.test(l)) || '';
  for (const key of Object.keys(STACKS)) {
    if (key === r.stack) continue;
    const other = STACKS[key];
    if (other.hhTitle === r.resume) continue;
    if (attachedLine.indexOf('«' + other.hhTitle + '»') >= 0) {
      console.log('  ' + r.id + ' (' + r.stack + '): упоминает чужое резюме «' + other.hhTitle + '»');
      bad++;
    }
  }
  if (!attachedLine) {
    console.log('  ' + r.id + ' (' + r.stack + '): нет строки о прикреплённом резюме');
    bad++;
  }
  // 4. Один факт не повторяется двумя формулировками — ни внутри блока
  // достижений, ни между планом и достижениями.
  const proofLines = r.letter.split('\n').filter((l) => /^— /.test(l) && !/^— «/.test(l));
  for (let i = 0; i < proofLines.length; i++) {
    for (let j = i + 1; j < proofLines.length; j++) {
      if (sameFact(proofLines[i], proofLines[j])) {
        console.log('  ' + r.id + ' (' + r.stack + '): повторяется факт: ' + proofLines[i].slice(0, 40) + ' / ' + proofLines[j].slice(0, 40));
        bad++;
      }
    }
  }
  // 5. Стек выводится из заголовка вакансии детерминированно.
  const again = stackFor(r.title, '').stack;
  if (again !== r.stack && again !== DEFAULT_STACK) {
    console.log('  ' + r.id + ': стек в письме «' + r.stack + '», а по заголовку выходит «' + again + '»');
    bad++;
  }
}

// Маршрутизация проверяется отдельно, на явных заголовках.
const ROUTING = [
  ['QA-инженер (AI First, CRM)', 'qa'],
  ['Инженер по тестированию', 'qa'],
  ['Тестировщик локализации', 'qa'],
  ['Junior Python-разработчик', 'python'],
  ['Специалист по парсингу данных', 'python'],
  ['Backend Engineer (Python)', 'backend'],
  ['Junior Backend-разработчик', 'backend'],
  ['Junior Frontend-разработчик', 'frontend'],
  ['Разработчик Rust/C++', 'cpp'],
  ['Разработчик игр — C++ и Rust', 'gamedev'],
  ['Младший разработчик / Junior Developer', 'python'],
  ['Инженер по внедрению', 'python'],
];
for (const [title, want] of ROUTING) {
  const got = stackFor(title, '').stack;
  if (got !== want) {
    console.log('  маршрутизация «' + title + '»: ждали ' + want + ', получили ' + got);
    bad++;
  }
}

// У каждого стека, который реально используется, должно быть своё резюме.
// Пропуск означал бы, что письма пишутся под несуществующее резюме.
for (const s of Object.keys(byStack)) {
  const p = STACKS[s];
  if (!p) {
    console.log('  стек ' + s + ' использован, но не описан в STACKS');
    bad++;
  } else if (!p.hhTitle) {
    console.log('  стек ' + s + ': нет заголовка резюме');
    bad++;
  }
}

console.log('писем: ' + rows.length + ', по стекам: ' + JSON.stringify(byStack));
console.log('резюме на hh: ' +
  Object.keys(STACKS).map((s) => s + '=' + (STACKS[s].hhResumeReady ? 'создано' : 'нет')).join(', '));
console.log('нарушений: ' + bad);
process.exit(bad === 0 ? 0 : 1);