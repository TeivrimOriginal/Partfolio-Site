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
process.exit(bad === 0 ? 0 : 1);
