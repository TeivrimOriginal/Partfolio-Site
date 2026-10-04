// Письма читаются из LETTERS-SHORTLIST.json — то есть проверяется ровно то,
// что уйдёт в hh, а не промежуточный результат генератора.
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('LETTERS-SHORTLIST.json', 'utf8'));

const MIN_LEN = 500;
const MAX_LEN = 1500;
const MIN_UNIQUE = 45;
const FORBIDDEN = /undefined|NaN|\[object|composeLetter|JSON\.parse/;

let bad = 0;
const seen = new Map();
for (const r of rows) {
  const t = r.letter;
  const unique = new Set(t.replace(/[^a-zа-яё0-9]/gi, '').toLowerCase()).size;
  const problems = [];
  if (!t || t.length < MIN_LEN) problems.push('длина ' + (t ? t.length : 0));
  if (t.length > MAX_LEN) problems.push('слишком длинное ' + t.length);
  if (unique < MIN_UNIQUE) problems.push('уникальных символов ' + unique);
  if (FORBIDDEN.test(t)) problems.push('следы неподстановки');
  if (!/Данила Аринов/.test(t)) problems.push('нет подписи');
  // Письмо обязано называть вакансию и компанию, иначе это шаблон.
  if (t.indexOf(r.title) < 0) problems.push('не называет вакансию');
  if (r.company && t.indexOf(r.company) < 0) problems.push('не называет компанию');
  if (problems.length) { bad++; console.log('  ' + r.id + ' -> ' + problems.join(', ')); }
  if (seen.has(t)) { bad++; console.log('  ' + r.id + ' идентично ' + seen.get(t)); }
  seen.set(t, r.id);
}
console.log('писем: ' + rows.length + ', уникальных: ' + seen.size + ', проблемных: ' + bad);

// Вакансии, которые правило опыта помечено ложно, обязаны остаться в письмах.
// Без этой проверки следующий прогон, увидев в тексте слово «коммерческий»,
// отсечёт их и потеряет: у HireWay прямо написано, что подойдут pet-проекты.
const drop = require('./hh-shortlist-drop.js');
const protectedIds = (drop.KEEP_NOT_DROPPED || []).map((d) => d.id);
let protectedBad = 0;
for (const id of protectedIds) {
  const dropped = drop.some((d) => d.id === id);
  const written = rows.some((r) => r.id === id);
  if (dropped) { console.log('  ' + id + ' помечена как защищённая, но лежит в отсеве'); protectedBad++; }
  if (!written) { console.log('  ' + id + ' помечена как защищённая, но письма для неё нет'); protectedBad++; }
}
console.log('защищённых от ложного отсева: ' + protectedIds.length + ', нарушений: ' + protectedBad);
bad += protectedBad;

process.exit(bad === 0 ? 0 : 1);
