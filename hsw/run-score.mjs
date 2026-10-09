import { openDb } from './db.mjs';
import { scoreVacancy, THRESHOLD } from './score.mjs';

// Навыки из реальных резюме проекта. Не выдуманы: resume-fastapi.html и
// resume-python.html содержат именно этот набор.
const SKILLS = [
  'python', 'fastapi', 'pydantic', 'sqlalchemy', 'asyncio', 'aiohttp', 'httpx',
  'rest', 'api', 'sql', 'postgres', 'postgresql', 'sqlite', 'docker', 'celery',
  'redis', 'pytest', 'selenium', 'allure', 'git', 'linux', 'ci', 'ruff', 'mypy',
  'telegram', 'парсинг', 'автоматизация', 'rust', 'c++', 'unity', 'c#',
];

const db = openDb();
const rows = db.prepare(`
  SELECT v.*,
    (SELECT COUNT(*) FROM contacts c WHERE c.company_key = v.company_key) AS contacts_n,
    (SELECT COUNT(*) FROM dispatches d WHERE d.vacancy_id = v.id AND d.status = 'sent') AS channels_n
  FROM vacancies v
  ORDER BY v.last_seen DESC
`).all();

const scored = rows.map((v) => {
  const s = scoreVacancy(v, { resumeSkills: SKILLS, contactCount: v.contacts_n || 0, channelCount: v.channels_n || 0 });
  return { v, s };
});

const buckets = { high: 0, mid: 0, low: 0 };
for (const { s } of scored) {
  if (s.percent >= 75) buckets.high++;
  else if (s.percent >= THRESHOLD) buckets.mid++;
  else buckets.low++;
}
console.log(`посчитано: ${scored.length}`);
console.log(`>=75: ${buckets.high} · ${THRESHOLD}-74: ${buckets.mid} · <${THRESHOLD}: ${buckets.low}`);

console.log('\nтоп-10 по баллу:');
for (const { v, s } of scored.sort((a, b) => b.s.percent - a.s.percent).slice(0, 10)) {
  console.log(`  ${String(s.percent).padStart(3)} | ${v.title.slice(0, 40).padEnd(40)} | ${(v.company || '—').slice(0, 20).padEnd(20)} | стек ${s.stack || '—'}`);
}

console.log('\nпример разбора:');
const sample = scored.sort((a, b) => b.s.percent - a.s.percent)[0];
if (sample) {
  console.log(' ', sample.v.title, '→', sample.s.percent, '/ 100');
  for (const p of sample.s.parts) console.log(`    ${p.name}: ${p.got}/${p.max} — ${p.why.join('; ')}`);
  console.log('    вердикт:', sample.s.verdict);
  if (sample.s.missing.length) console.log('    не закрыто:', sample.s.missing.join(', '));
}

// Раскладываем по очередям и сохраняем разбор: письмо должно знать, за что
// начислены баллы, иначе порог 50 невозможно оспорить.
const upd = db.prepare(`
  UPDATE vacancies SET percent = ?, stack = ?, fit_why = ?, urgent = ?, status = ?
  WHERE id = ?
`);
for (const { v, s } of scored) {
  upd.run(
    s.percent,
    s.stack || null,
    JSON.stringify({ parts: s.parts, matched: s.matched, missing: s.missing, verdict: s.verdict }),
    s.urgent ? 1 : 0,
    s.passed ? 'scored' : 'leaks',
    v.id,
  );
}
console.log('\nочереди:', JSON.stringify(Object.fromEntries(
  db.prepare('SELECT status, COUNT(*) c FROM vacancies GROUP BY status').all().map((r) => [r.status, r.c]),
)));
console.log('LeaksData (ниже порога):', db.prepare("SELECT COUNT(*) c FROM vacancies WHERE status='leaks'").get().c);