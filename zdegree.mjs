// Проверка правила «требуется высшее» на реальных фразах.
//
// Тонкость, которая нашлась при разборе: «Высшее или среднее профессиональное
// образование» — это НЕ требование высшего. Среднее профессиональное = СПО,
// то есть ровно то, что у него есть. Такие вакансии блокировать нельзя.
//
// Правило разделения:
//   БЛОКИРУЕТ  «высшее образование», «высшее техническое образование»,
//              «образование высшее», «диплом о высшем», «незаконченное высшее»
//   НЕ БЛОКИРУЕТ  «высшее или среднее профессиональное образование»,
//              «высшее или среднетехническое образование»,
//              «с высшим или средним профессиональным образованием»
//
// Проверка идёт по всей выборке: сколько вакансий содержат «высш», сколько
// из них правило считает требованием высшего, и что с остальными.
import fs from 'node:fs';

const DEGREE_BLOCK = [
  { re: /высш(ее|его)\s+образован/i, why: 'требуется высшее образование' },
  { re: /незаконч(енн|енное|енный)\s+высш/i, why: 'требуется незаконченное высшее' },
  { re: /диплом\w*\s+(о\s+)?высшем/i, why: 'требуется диплом о высшем' },
  { re: /\bмагистрат\w*\b/i, why: 'требуется магистратура' },
];

// «высшее ИЛИ среднее» — СПО подходит, значит не блокируем.
const OR_MED = [
  /высш\w*\s+или\s+средн/i,
  /высш\w*\s+или\s+средне-/i,
  /с\s+высш\w*\s+или\s+средн/i,
  /высш\w*\s+или\s+же\s+средн/i,
];

function blockOf(desc) {
  const d = String(desc || '');
  // Сначала вырезаем куски «высшее или среднее», чтобы они не ловились
  // правилом «требуется высшее образование».
  const cleaned = d.replace(new RegExp(OR_MED.map(r => r.source).join('|'), 'gi'), 'ВЫСШЕ_ИЛИ_СРЕДНЕЕ');
  const hits = DEGREE_BLOCK.filter(b => b.re.test(cleaned)).map(b => b.why);
  return hits;
}

const files = process.argv.slice(2);
const seen = new Map();
for (const f of files) for (const v of JSON.parse(fs.readFileSync(f, 'utf8'))) { if (v.state) continue; if (!seen.has(v.id)) seen.set(v.id, v); }
const list = [...seen.values()];

const withVysh = list.filter(v => /высш/i.test(v.desc || ''));
const blocked = withVysh.filter(v => blockOf(v.desc).length);
const allowed = withVysh.filter(v => !blockOf(v.desc).length);

console.log('вакансий всего:', list.length);
console.log('со словом «высш» в тексте:', withVysh.length);
console.log('  из них правило считает требованием ТОЛЬКО высшего:', blocked.length);
console.log('  из них СПО подходит («высшее или среднее» и т.п.):', allowed.length);
console.log('\n--- примеры, где СПО подходит (правило молчит):');
for (const v of allowed.slice(0, 8)) {
  const m = v.desc.match(/.{0,70}высш.{0,80}/i);
  console.log('  ', v.id, '|', v.title.slice(0, 45), '::', m ? m[0].replace(/\s+/g, ' ') : '');
}
console.log('\n--- примеры, где требуется именно высшее (правило срабатывает):');
for (const v of blocked.slice(0, 8)) {
  const m = v.desc.match(/.{0,70}высш.{0,80}/i);
  console.log('  ', v.id, '|', v.title.slice(0, 45), '::', m ? m[0].replace(/\s+/g, ' ') : '');
}
