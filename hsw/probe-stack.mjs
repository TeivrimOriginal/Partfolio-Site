// Проверяю, что реально лежит в колонке stack после прогона run-score.
// Расхождение между тестом (стек пуст) и прогоном (стек «Backend») означает,
// что run-score импортирует старую копию модуля или база не перезаписана.
import { openDb } from './db.mjs';
import { scoreVacancy } from './score.mjs';

const db = openDb();

const rows = db.prepare(`
  SELECT id, title, percent, stack, status FROM vacancies
  WHERE stack IS NOT NULL ORDER BY percent DESC LIMIT 6
`).all();
console.log('строки со стеком в базе:');
for (const r of rows) console.log(`  ${r.id} ${String(r.percent).padStart(3)} ${String(r.stack).padEnd(10)} ${r.status} :: ${r.title.slice(0, 44)}`);

// Тот же заголовок, но пересчитанный прямо сейчас.
const sample = db.prepare("SELECT * FROM vacancies WHERE title LIKE '%SIEM%' LIMIT 1").get();
if (sample) {
  const fresh = scoreVacancy(sample, { resumeSkills: ['python', 'api', 'sql'], contactCount: 0 });
  console.log(`\nSIEM сейчас: stack=${fresh.stack || '—'} percent=${fresh.percent}`);
  console.log('  в базе: stack=' + (sample.stack || '—') + ' percent=' + sample.percent);
}

const nulls = db.prepare('SELECT COUNT(*) c FROM vacancies WHERE stack IS NULL').get().c;
const notNull = db.prepare('SELECT COUNT(*) c FROM vacancies WHERE stack IS NOT NULL').get().c;
console.log(`\nвсего ${nulls + notNull}: без стека ${nulls}, со стеком ${notNull}`);