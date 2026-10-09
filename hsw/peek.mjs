// Сводка по собранной базе. Отдельный файл: PowerShell ломает `node -e`
// на кириллице и кавычках внутри регулярных выражений.
import { openDb, stats } from './db.mjs';

const db = openDb();

const byExp = db.prepare('SELECT experience, COUNT(*) c FROM vacancies GROUP BY experience').all();
console.log('по опыту:', byExp.map((r) => `${r.experience}=${r.c}`).join(' | '));

const top = db.prepare('SELECT company, COUNT(*) c FROM vacancies GROUP BY company ORDER BY c DESC LIMIT 6').all();
console.log('топ компаний:', top.map((r) => `${r.company}=${r.c}`).join(' | '));

const py = db.prepare("SELECT external_id, title, company, salary_from, valid_through FROM vacancies WHERE lower(title) LIKE '%python%' LIMIT 4").all();
console.log('python-вакансии:');
for (const v of py) console.log('  ', v.external_id, '|', v.title.slice(0, 44), '|', v.company, '|', v.salary_from ?? '—', '| до', v.valid_through ?? '—');

const empty = db.prepare("SELECT COUNT(*) c FROM vacancies WHERE description IS NULL OR description = ''").get().c;
console.log('без описания:', empty, 'из', stats(db).vacancies);

const soon = db.prepare("SELECT external_id, title, valid_through FROM vacancies WHERE valid_through IS NOT NULL ORDER BY valid_through LIMIT 3").all();
console.log('сгорают раньше всех:', soon.map((v) => `${v.title.slice(0, 26)} (до ${v.valid_through})`).join(' | '));