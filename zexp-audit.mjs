// Аудит правила «нужен опыт»: что оно ловит и что пропускает.
// Фразы берутся из реальных вакансий выборки, где hh поставил метку
// «1–3 года» или «3–6 лет» — и сверяется, есть ли в тексте названный
// минимум. Если нет — значит правило должно это ловить по-другому
// (например, «опыт работы в 1С» без числа).
import fs from 'node:fs';

const EXP_BLOCK = [
  { re: /опыт\s+работы[^.]{0,70}?\bот\s+\d+\s*(лет|года|г\b|месяц\w*)/i, why: 'нужен опыт от N лет/месяцев' },
  { re: /\b(\d\s*\+\s*(лет|года|г\b))/, why: 'нужен опыт 2+ лет' },
  { re: /\b[2-9]\s*(\-\s*[0-9])?\s*года?\s+опыта/i, why: 'нужен опыт 2+ года' },
  { re: /коммерческ\w*\s+(опыт|разработк)/i, why: 'нужен коммерческий опыт' },
  { re: /стаж[её]р[^.]{0,90}?с\s+высшим/i, why: 'стажировка только с высшим' },
  { re: /опыт\s+работы[^.]{0,40}?от\s+1\s*года/i, why: 'нужен опыт от 1 года' },
  { re: /стаж[её]р\s+с\s+опытом/i, why: 'нужен опыт для стажировки' },
];

const files = process.argv.slice(2);
const seen = new Map();
for (const f of files) for (const v of JSON.parse(fs.readFileSync(f, 'utf8'))) { if (v.state) continue; if (!seen.has(v.id)) seen.set(v.id, v); }
const list = [...seen.values()];

// Вакансии, где hh поставил «1–3 года» или больше, но в тексте нет числа
const needExp = list.filter(v => v.experience && v.experience !== 'noExperience');
const caught = needExp.filter(v => EXP_BLOCK.some(b => b.re.test(v.desc || '')));
const missed = needExp.filter(v => !EXP_BLOCK.some(b => b.re.test(v.desc || '')));

console.log('всего вакансий:', list.length);
console.log('hh требует опыт (метка не «Без опыта»):', needExp.length);
console.log('  из них правило поймало по тексту:', caught.length);
console.log('  из них правило НЕ поймало:', missed.length);
console.log('\n--- примеры НЕ пойманных (требуют опыта, но без числа в тексте):');
for (const v of missed.slice(0, 18)) {
  const m = (v.desc || '').match(/.{0,60}опыт.{0,90}/i);
  console.log('  ', v.id, '|', (v.title || '').slice(0, 42), '::', m ? m[0].replace(/\s+/g, ' ') : '(нет слова «опыт»)');
}
