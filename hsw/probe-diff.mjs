// Расхождение: run-score показывает 30 прошедших, run-letters показывает
// SIEM со стеком Backend и 56 баллами. Проверяю все строки с таким
// заголовком и то, что реально лежит в колонках.
import { openDb } from './db.mjs';
import { scoreVacancy } from './score.mjs';

const db = openDb();

console.log('строки с SIEM:');
const siem = db.prepare("SELECT id, source, external_id, title, percent, stack, status FROM vacancies WHERE title LIKE '%SIEM%'").all();
for (const r of siem) console.log(' ', JSON.stringify(r));

console.log('\nстроки со стеком Backend, отсортированные по проценту:');
const backends = db.prepare("SELECT id, title, percent, stack, status FROM vacancies WHERE stack = 'Backend' ORDER BY percent DESC").all();
for (const r of backends) console.log(`  ${String(r.percent).padStart(3)} ${r.status.padEnd(8)} ${r.title.slice(0, 52)}`);

console.log('\nпересчёт всех подряд (что должен сделать run-score):');
const all = db.prepare('SELECT * FROM vacancies').all();
const now = new Map();
for (const v of all) {
  const s = scoreVacancy(v, { resumeSkills: ['python'], contactCount: 0 });
  now.set(v.id, s);
}
const diff = all.filter((v) => (v.stack ?? null) !== (now.get(v.id).stack ?? null));
console.log(`  расходится по стеку: ${diff.length} из ${all.length}`);
for (const v of diff.slice(0, 8)) {
  console.log(`   ${v.id}: в базе «${v.stack}», сейчас «${now.get(v.id).stack}» :: ${v.title.slice(0, 46)}`);
}