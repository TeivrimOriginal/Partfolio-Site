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

// Контакты берём из уже опубликованного резюме, а не пишем руками: в гостевой
// форме Хабра они и есть полями, и опечатка в телефоне означает, что работодатель
// не дозвонится после отклика.
const REF = 'resume.html';
const refHtml = fs.existsSync(REF) ? fs.readFileSync(REF, 'utf8') : '';
const phone = (refHtml.match(/\+7[\s\d\-()]{9,20}/) || [''])[0].trim();
const email = (refHtml.match(/[\w.\-]+@[\w.\-]+\.\w+/) || [''])[0];
const telegram = (refHtml.match(/t\.me\/([A-Za-z0-9_]+)/) || ['', ''])[1];

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
    // Ссылка на резюме под этот стек и PDF того же резюме: в гостевой форме
    // поле называется «Ссылка на резюме», а работодатель кликает по нему.
    resumeUrl: profile.publicUrl || null,
    resumePdf: profile.publicUrl ? profile.publicUrl.replace(/\.html$/, '.pdf') : null,
    quoted: reqs.length,
    letter: text,
    len: text.length,
    // Готовые значения полей гостевой формы. Ключи совпадают с именами полей на
    // career.habr.com, чтобы заполнение не было угадыванием.
    guestForm: {
      'response[resumeHref]': profile.publicUrl || '',
      'response[contactPhone]': phone,
      'response[telegram]': telegram ? '@' + telegram : '',
    },
    // Что мешает отправить без человека. Гостевой отклик на Хабре закрыт
    // reCAPTCHA v3: токен нужен до нажатия, кнопка «Откликнуться без
    // регистрации» остаётся disabled, пока captchaToken пуст. Проверено
    // 04.10.2026: grecaptcha.execute() не возвращает токен из этого окружения.
    blockedBy: 'captcha',
    blockedNote: 'гостевая форма требует reCAPTCHA v3; нужен человек',
  });
}

fs.writeFileSync('HABR-LETTERS.json', JSON.stringify(out, null, 1), 'utf8');

const noResume = out.filter((r) => !r.resumeUrl).length;
if (noResume) {
  console.log('ВНИМАНИЕ: у ' + noResume + ' вакансий нет ссылки на резюме — гостевую форму заполнить нечем.');
}

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
console.log('контакты из ' + REF + ': телефон «' + phone + '», телеграм «@' + telegram + '», почта ' + email);
for (const r of out) {
  console.log('  ' + r.id + ' | ' + r.stack.padEnd(8) + ' | ' + r.level.padEnd(10) + ' | резюме «' + r.resume + '»' +
    (r.resumeReady ? '' : ' НЕ СОЗДАНО') + ' | цитат ' + r.quoted);
}
const needResume = out.filter((r) => !r.resumeReady).length;
if (needResume) console.log('\nнужно создать резюме на площадке для ' + needResume + ' вакансий: ' +
  [...new Set(out.filter((r) => !r.resumeReady).map((r) => r.resume))].join(', '));
process.exit(dup === 0 ? 0 : 1);