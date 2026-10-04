// Письма для вакансий Хабр Карьеры.
//
// Генератор тот же, что и для hh — `hh-letter.js`, и профиль тот же,
// `hh-resume-stack.js`. Это не совпадение: требование «письмо под то резюме,
// которое прикрепляется» одинаково на обеих площадках, а две копии генератора
// разошлись бы за неделю.
//
// Отличие от сборки для hh: текст описания здесь уже есть в отчёте
// collect-habr-career.js, поэтому цитаты берутся из него напрямую, без
// повторного хода на страницу вакансии.
const fs = require('fs');
const { composeLetter, extractRequirements } = require('./hh-letter.js');
const { stackFor, profileFor } = require('./hh-resume-stack.js');

const report = JSON.parse(fs.readFileSync('habr-vacancies.json', 'utf8'));
const rows = report.vacancies || [];

const out = [];
const texts = new Map();
let dup = 0;

for (const v of rows) {
  const desc = v.desc || '';
  // Цитаты берём из полного описания, а не из обрезанного в отчёте: генератор
  // сам выбирает предложения-требования.
  const routed = stackFor(v.title, desc);
  const profile = profileFor(routed.stack);
  const text = composeLetter(v.title, desc, v.company, profile);
  const reqs = extractRequirements(desc, 2, v.title);
  if (texts.has(text)) { dup++; console.log('  ДУБЛЬ: ' + v.id + ' = ' + texts.get(text)); }
  texts.set(text, v.id);
  out.push({
    id: v.id,
    href: 'https://career.habr.com' + v.href,
    title: v.title,
    company: v.company,
    level: v.level,
    remote: v.remote,
    responses: v.responses,
    stack: routed.stack,
    stackWhy: routed.stackWhy,
    resume: profile.hhTitle,
    resumeId: profile.resumeId,
    resumeReady: profile.hhResumeReady,
    quoted: reqs.length,
    letter: text,
    len: text.length,
  });
}

fs.writeFileSync('HABR-LETTERS.json', JSON.stringify(out, null, 1), 'utf8');

let md = ['# Письма — Хабр Карьера', '',
  'Собраны тем же генератором, что и письма для hh: `hh-letter.js`, профиль — `hh-resume-stack.js`.',
  'Каждое письмо начинается с «кто я» в том стеке, под который выбрано резюме, и называет прикреплённое резюме.', '',
  'Вакансий после отбора: ' + out.length + '. Проверено: ' + texts.size + ' уникальных, дублей ' + dup + '.', ''];
for (const r of out) {
  md.push('## ' + r.id + ' — ' + r.title);
  md.push('**' + r.company + '** · уровень: ' + r.level + ' · удалённая: ' + (r.remote ? 'да' : 'нет') +
    (r.responses ? ' · откликов уже: ' + r.responses : ''));
  md.push('стек: **' + r.stack + '** · резюме: «' + r.resume + '»' + (r.resumeReady ? '' : ' — на площадке ещё не создано'));
  md.push('длина письма: ' + r.len + ', цитат из описания: ' + r.quoted);
  md.push('');
  md.push(r.letter);
  md.push('');
}
fs.writeFileSync('HABR-LETTERS.md', md.join('\n'), 'utf8');

console.log('вакансий: ' + out.length + ', уникальных писем: ' + texts.size + ', дублей: ' + dup);
for (const r of out) {
  console.log('  ' + r.id + ' | ' + r.stack.padEnd(8) + ' | ' + r.level.padEnd(10) + ' | резюме «' + r.resume + '»' +
    (r.resumeReady ? '' : ' НЕ СОЗДАНО') + ' | цитат ' + r.quoted);
}
const needResume = out.filter((r) => !r.resumeReady).length;
if (needResume) console.log('\nнужно создать резюме на площадке для ' + needResume + ' вакансий: ' +
  [...new Set(out.filter((r) => !r.resumeReady).map((r) => r.resume))].join(', '));
process.exit(dup === 0 ? 0 : 1);