// Письма для вакансий remote-job.ru.
//
// Генератор и профиль те же, что на hh и Хабре: `hh-letter.js` и
// `hh-resume-stack.js`. Три копии генератора разошлись бы за неделю — уже
// разошлись однажды, когда выдуманный факт прожил в одной копии и ушёл в 14
// писем. Факты берутся из профилей, а те проверяются `test-proof-sources.js`.
//
// Отличие в данных: зарплата тут указана строкой, поэтому она попадает в письмо
// как факт. Это палка о двух концах — про цифру из вакансии писать можно, а
// свои ожидания нельзя: он ни разу не называл желаемую зарплату вслух.
const fs = require('fs');
const { composeLetter, extractRequirements } = require('./hh-letter.js');
const { stackFor, profileFor } = require('./hh-resume-stack.js');

const report = JSON.parse(fs.readFileSync('remote-job-vacancies.json', 'utf8'));
const rows = report.vacancies || [];

const REF = 'resume.html';
const refHtml = fs.existsSync(REF) ? fs.readFileSync(REF, 'utf8') : '';
const phone = (refHtml.match(/\+7[\s\d\-()]{9,20}/) || [''])[0].trim();
const telegram = (refHtml.match(/t\.me\/([A-Za-z0-9_]+)/) || ['', ''])[1];

const out = [];
const texts = new Map();
let dup = 0;
let noResume = 0;

for (const v of rows) {
  const desc = v.desc || '';
  const routed = stackFor(v.title, desc);
  const profile = profileFor(routed.stack);
  const text = composeLetter(v.title, desc, v.company, profile);
  const reqs = extractRequirements(desc, 2, v.title);
  if (texts.has(text)) { dup++; console.log('  ДУБЛЬ: ' + v.id + ' = ' + texts.get(text)); }
  texts.set(text, v.id);
  if (!profile.publicUrl) noResume++;
  out.push({
    id: v.id,
    href: v.href,
    title: v.title,
    company: v.company,
    salary: v.salary,
    salaryFloor: v.salaryFloor,
    stack: routed.stack,
    stackWhy: routed.stackWhy,
    resume: profile.hhTitle,
    resumeUrl: profile.publicUrl || null,
    resumePdf: profile.publicUrl ? profile.publicUrl.replace(/[.]html$/, '.pdf') : null,
    quoted: reqs.length,
    letter: text,
    len: text.length,
    contacts: { phone: phone, telegram: telegram ? '@' + telegram : '' },
  });
}

fs.writeFileSync('REMOTE-JOB-LETTERS.json', JSON.stringify(out, null, 1), 'utf8');

const byStack = {};
for (const r of out) byStack[r.stack] = (byStack[r.stack] || 0) + 1;

const md = [
  '# Письма — remote-job.ru', '',
  'Собраны тем же генератором, что письма для hh и Хабр Карьеры.', '',
  'Вакансий: ' + out.length + '. Проверено: ' + texts.size + ' уникальных, дублей ' + dup + '.', '',
  'По стекам: ' + JSON.stringify(byStack), '',
];
for (const r of out) {
  md.push('## ' + r.id + ' — ' + r.title);
  md.push('**' + r.company + '**' + (r.salary ? ' · ' + r.salary : ' · зарплата не указана'));
  md.push('стек: **' + r.stack + '** · резюме: ' + (r.resumeUrl || 'НЕТ ССЫЛКИ'));
  md.push('длина письма: ' + r.len + ', цитат из описания: ' + r.quoted);
  md.push('');
  md.push(r.letter);
  md.push('');
}
fs.writeFileSync('REMOTE-JOB-LETTERS.md', md.join('\n'), 'utf8');

console.log('вакансий: ' + out.length + ', уникальных писем: ' + texts.size + ', дублей: ' + dup);
console.log('по стекам: ' + JSON.stringify(byStack));
console.log('без ссылки на резюме: ' + noResume);
const lens = out.map((r) => r.len);
if (lens.length) console.log('длина писем: от ' + Math.min(...lens) + ' до ' + Math.max(...lens));
process.exit(dup === 0 && noResume === 0 ? 0 : 1);
