// Собирает письма для шорт-листа по реальным требованиям из описаний hh.
//
// Проверка уникальности обязательна: 11 писем из 20 когда-то выходили
// побайтово одинаковыми, потому что все эти вакансии попадали в одну группу
// требований. Рекрутеру, у которого в разных откликах лежит один текст,
// это видно сразу, поэтому одинаковые письма — дефект, а не мелочь.
const fs = require('fs');
const list = require('./hh-shortlist.js');
const drop = require('./hh-shortlist-drop.js');
const { composeLetter } = require('./hh-letter.js');
const { stackFor, profileFor, STACKS } = require('./hh-resume-stack.js');

// Данные в пяти файлах по партиям: 1, 2, 3, 4, 5.
// Склеиваем, потому что все партии обязаны идти через один и тот же генератор
// и одну проверку уникальности — иначе уникальность проверяется только внутри
// партии, а это как раз тот случай, когда два отклика у разных компаний
// получаются побайтово одинаковыми.
const items = [
  ...JSON.parse(fs.readFileSync('hh-shortlist-data.json', 'utf8')).items,
  ...JSON.parse(fs.readFileSync('hh-shortlist-data-b2.json', 'utf8')).items,
  ...JSON.parse(fs.readFileSync('hh-shortlist-data-b3.json', 'utf8')).items,
  ...JSON.parse(fs.readFileSync('hh-shortlist-data-b4.json', 'utf8')).items,
  ...JSON.parse(fs.readFileSync('hh-shortlist-data-b5.json', 'utf8')).items,
];

// Имя компании берём из hh-shortlist.js, а не из DOM. В DOM к названию
// приклеены кнопки и бейджи: «Хочу тут работать», «Финалист Рейтинга
// работодателей hh.ru», «У работодателя есть аккредитация», а у части
// вакансий вместо имени вовсе отдаётся «Контакты» или «Связаться».
// Шорт-лист заполнен названиями с карточек поиска — там они чистые.
function companyFor(id) {
  const fromList = (list.find((v) => v.id === id) || {}).co || '';
  if (fromList) return fromList;
  const row = items.find((x) => x.id === id);
  return ((row && row.companyDom) || '')
    .replace(/Хочу тут работать|ФиналистРейтинга работодателей hh\.ru|Проверенный работодатель|IT-компания|У работодателя есть аккредитация|ПобедительПремии HR-Бренд|Топ-200Рейтинга работодателей hh\.ru|Открытый|Показывает отзывы от сотрудников|Контакты|Связаться/g, '')
    .trim();
}

const out = [];
const texts = new Map();
let dup = 0;
let dropped = 0;

for (const v of list) {
  // Отклонённые по тексту описания пропускаем здесь, а не правим руками:
  // причина лежит в hh-shortlist-drop.js и её можно перепроверить.
  const cut = drop.find((d) => d.id === v.id);
  if (cut) { dropped++; continue; }

  const row = items.find((x) => x.id === v.id);
  const sents = row ? row.sents : [];
  const company = companyFor(v.id);
  // Описание склеиваем из отобранных предложений: этого хватает генератору,
  // а пересылать полный текст вакансии ради пары цитат незачем.
  const desc = sents.join('. ');
  const routed = stackFor(v.title, desc);
  const profile = profileFor(routed.stack);
  const text = composeLetter(v.title, desc, company, profile);
  const quoted = (text.match(/^— «/gm) || []).length;
  if (texts.has(text)) { dup++; console.log('  ДУБЛЬ: ' + v.id + ' = ' + texts.get(text)); }
  texts.set(text, v.id);
  out.push({ id: v.id, title: v.title, company, why: v.why, sents, letter: text, quoted, len: text.length, stack: routed.stack, stackWhy: routed.why, resume: profile.hhTitle, resumeId: profile.resumeId, resumeReady: profile.hhResumeReady });
}

fs.writeFileSync('LETTERS-SHORTLIST.json', JSON.stringify(out, null, 1), 'utf8');

let md = ['# Письма к шорт-листу', '',
  'Собраны генератором `hh-letter.js` из текста описаний вакансий на hh.',
  'Каждое письмо цитирует конкретные требования из описания и обращается по имени компании.', '',
  'Проверка при отправке: длина поля после вставки сверяется с ожидаемой, отправка идёт только после снятия `disabled` с кнопки.', ''];
for (const r of out) {
  md.push('## ' + r.id + ' — ' + r.title);
  md.push('**' + r.company + '** · беру потому что: ' + r.why);
  md.push('стек: **' + r.stack + '** (' + r.stackWhy + ') · прикрепляю резюме: «' + r.resume + '»' + (r.resumeReady ? '' : ' — на hh ещё не создано'));
  md.push('цитат из описания: ' + r.quoted + ', длина письма: ' + r.len);
  md.push('');
  md.push(r.letter);
  md.push('');
}
fs.writeFileSync('LETTERS-SHORTLIST.md', md.join('\n'), 'utf8');

const withQuotes = out.filter((r) => r.quoted > 0).length;
const noData = out.filter((r) => !r.sents.length).map((r) => r.id);
console.log('в отборе: ' + list.length + ', отклонено по описанию: ' + dropped + ', в письмах: ' + out.length);
console.log('уникальных писем: ' + texts.size + ', дублей: ' + dup);
console.log('писем с цитатой из описания: ' + withQuotes + ' из ' + out.length);

// Сколько вакансий под какое резюме. Это и есть ответ на вопрос «какое резюме
// закреплять за какой вакансией», и одновременно список недостающих резюме.
const byStack = {};
for (const r of out) {
  if (!byStack[r.stack]) byStack[r.stack] = { count: 0, resume: r.resume, ready: r.resumeReady };
  byStack[r.stack].count++;
}
console.log('вакансии по стекам и нужные резюме на hh:');
for (const s of Object.keys(byStack).sort()) {
  const b = byStack[s];
  console.log('  ' + s.padEnd(9) + String(b.count).padStart(3) + ' вакансий · резюме «' + b.resume + '» ' + (b.ready ? 'создано' : 'НЕ СОЗДАНО'));
}
console.log('без цитаты (в описании нет предложений-требований): ' + (noData.join(', ') || 'нет'));
if (dropped) {
  console.log('причины отклонений:');
  for (const d of drop) if (list.some((v) => v.id === d.id)) console.log('  ' + d.id + ' — ' + d.reason);
}
// Отклонений без цитаты может быть несколько: у части вакансий описания
// короткие и не содержат ни одного предложения с требованиями.
process.exit(dup === 0 && withQuotes >= out.length - noData.length ? 0 : 1);
