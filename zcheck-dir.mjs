// Проверка: не уезжают ли направления в вакансии, где слова только в описании.
import fs from 'node:fs';
const files = process.argv.slice(2);
const seen = new Map();
for (const f of files) {
  for (const v of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    if (v.state) continue;
    if (seen.has(v.id)) continue;
    seen.set(v.id, v);
  }
}
const list = [...seen.values()];

// Сколько вакансий содержат «1С» ТОЛЬКО в описании, а не в заголовке
const onlyDesc1c = list.filter(v => !/1\s?с/i.test(v.title || '') && /1\s?с/i.test(v.desc || ''));
console.log('«1С» только в описании:', onlyDesc1c.length, 'из', list.length);
for (const v of onlyDesc1c.slice(0, 12)) console.log('   ', v.id, '|', v.title, '|', v.employer);

// Ложное срабатывание «сетев» внутри «электросетевая»
const elec = list.filter(v => /электросетев/i.test(v.title || ''));
console.log('«электросетевая компания» (ложное срабатывание «сетев»):', elec.length);
for (const v of elec.slice(0, 5)) console.log('   ', v.id, '|', v.title);
