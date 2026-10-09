import { openDb } from './db.mjs';

const db = openDb();

const top = db.prepare(`
  SELECT id, title, percent, stack, status FROM vacancies
  WHERE stack IS NOT NULL ORDER BY percent DESC LIMIT 10
`).all();
console.log('топ-10 со стеком:');
for (const r of top) {
  console.log(`  ${String(r.percent).padStart(3)} ${r.status.padEnd(8)} ${(r.stack || '').padEnd(16)} ${r.title.slice(0, 44)}`);
}

const q = Object.fromEntries(
  db.prepare('SELECT status, COUNT(*) c FROM vacancies GROUP BY status').all().map((r) => [r.status, r.c]),
);
console.log('\nвсего', db.prepare('SELECT COUNT(*) c FROM vacancies').get().c, '· без стека', db.prepare('SELECT COUNT(*) c FROM vacancies WHERE stack IS NULL').get().c);
console.log('очереди:', JSON.stringify(q));

const nonEng = db.prepare("SELECT percent, stack, status, title FROM vacancies WHERE title LIKE '%SIEM%' OR title LIKE '%1С%' OR title LIKE '%по продажам%'").all();
console.log('\nдолжны быть без стека:');
for (const r of nonEng) console.log(`  ${String(r.percent).padStart(3)} ${String(r.stack).padEnd(8)} ${r.status.padEnd(8)} ${r.title.slice(0, 46)}`);