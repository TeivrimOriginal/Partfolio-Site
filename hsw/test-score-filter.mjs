// Проверяю правило «не ИТ-разработка» на реальных заголовках из базы,
// включая те, что ошибочно попадали в очередь, и те, что попадать должны.
import { openDb } from './db.mjs';
import { scoreVacancy } from './score.mjs';

const db = openDb();
const rows = db.prepare('SELECT * FROM vacancies ORDER BY last_seen DESC').all();

const SKILLS = ['python', 'fastapi', 'pydantic', 'sqlalchemy', 'asyncio', 'httpx', 'rest', 'api',
  'sql', 'postgres', 'sqlite', 'docker', 'celery', 'redis', 'pytest', 'selenium', 'allure',
  'git', 'linux', 'ci', 'ruff', 'mypy', 'telegram', 'парсинг', 'автоматизация', 'rust', 'c++', 'c#'];

// Явные ожидания: заголовок -> проходит ли стековый фильтр.
const EXPECT_BLOCK = [
  'Инженер по внедрению SIEM (KUMA / Kaspersky)',
  'Администратор веб-сервера',
  'Программист 1С (начинающий)',
  'Retention manager (iGaming)',
  'Ассистент менеджера по продажам Битрикс24',
  'Юрист-эксперт',
  'Менеджер по продажам',
  'Врач-терапевт',
];
const EXPECT_PASS = [
  'Junior Python-разработчик',
  'Python developer',
  'Backend-разработчик (Python/JS)',
  'Стажер-разработчик C++',
  'QA-инженер',
  'Инженер по тестированию',
  'Разработчик торговых роботов (Lua / Python / C++)',
];

const scored = rows.map((v) => ({ v, s: scoreVacancy(v, { resumeSkills: SKILLS, contactCount: 2 }) }));
const stackOk = (t) => scored.find((x) => x.v.title === t)?.s.stack != null;

console.log('должны отсеяться как не-разработка:');
let bad = 0;
for (const t of EXPECT_BLOCK) {
  const found = scored.find((x) => x.v.title === t);
  if (!found) { console.log(`  ? нет в базе: ${t}`); continue; }
  const ok = !stackOk(t);
  if (!ok) bad++;
  console.log(`  ${ok ? '+' : 'ОШИБКА'} стек=${found.s.stack || '—'} %=${found.s.percent} :: ${t}`);
}

console.log('\nдолжны пройти:');
for (const t of EXPECT_PASS) {
  const found = scored.find((x) => x.v.title === t);
  if (!found) { console.log(`  ? нет в базе: ${t}`); continue; }
  const ok = stackOk(t);
  if (!ok) bad++;
  console.log(`  ${ok ? '+' : 'ОШИБКА'} стек=${found.s.stack || '—'} %=${found.s.percent} :: ${t}`);
}

console.log(`\nошибок ожидания: ${bad}`);

const b = { '>=75': 0, '50-74': 0, '<50': 0 };
for (const { s } of scored) {
  if (s.percent >= 75) b['>=75']++;
  else if (s.percent >= 50) b['50-74']++;
  else b['<50']++;
}
console.log('пересчёт:', JSON.stringify(b), '· всего', scored.length);
console.log('\nновый топ-8:');
for (const { v, s } of [...scored].sort((a, x) => x.s.percent - a.s.percent).slice(0, 8)) {
  console.log(`  ${String(s.percent).padStart(3)} | ${v.title.slice(0, 46).padEnd(46)} | стек ${s.stack || '—'}`);
}