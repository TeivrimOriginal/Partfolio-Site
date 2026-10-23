// Сводка по собранному: сколько вакансий реально без требований опыта,
// сколько закрыто высшим образованием, сколько совмещаемо с учёбой.
// Читает все файлы zfull-*.json / zneigh-full-*.json.
import fs from 'node:fs';
import { employerType } from './zemp.mjs';

const files = process.argv.slice(2).filter(f => fs.existsSync(f));
const seen = new Map();
for (const f of files) {
  for (const v of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    if (v.state) continue;
    if (seen.has(v.id)) continue;
    seen.set(v.id, v);
  }
}
const list = [...seen.values()];
const byExp = {};
for (const v of list) byExp[v.experience] = (byExp[v.experience] || 0) + 1;
console.log('файлов:', files.length, '| вакансий:', list.length);
console.log('по опыту (метка hh):', JSON.stringify(byExp));

const et = {};
for (const v of list) { const t = employerType(v.employer).tag; et[t] = (et[t] || 0) + 1; }
console.log('по типу работодателя:');
for (const [k, n] of Object.entries(et).sort((a, b) => b[1] - a[1])) console.log('  ', k, n);

const gov = list.filter(v => employerType(v.employer).gov);
console.log('гос/муниципальные:', gov.length);
const noexp = list.filter(v => v.experience === 'noExperience');
console.log('метка «Без опыта»:', noexp.length);
const short = list.filter(v => {
  const n = [...(v.hours || '').matchAll(/(\d+)\s*(?:ч|час)/g)].map(x => Number(x[1]));
  return n.length && Math.max(...n) <= 8;
});
console.log('смена до 8 ч:', short.length);
const stud = list.filter(v => /студент|частичная занятость|подработк|гибкий|свободный график|стаж/i.test((v.desc || '') + ' ' + v.schedule + ' ' + v.hours));
console.log('с пометкой «студент/частичная/подработка/гибкий» в тексте:', stud.length);
fs.writeFileSync('F:/tmp/opencode/summary.json', JSON.stringify({ n: list.length, byExp, et, gov: gov.length, noexp: noexp.length, short: short.length, stud: stud.length }), 'utf8');
