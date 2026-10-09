import fs from 'node:fs';
import { openDb, sharedEmails } from './db.mjs';
import { draftLetter, checkClaims } from './letters.mjs';
import { resumeForStack } from './resumes.mjs';
import { pickAddress } from './target.mjs';
import { THRESHOLD } from './score.mjs';

// Письма для вакансий, прошедших порог. Порядок — партиями по 10, как в ТЗ.

const db = openDb();
const limit = Number(process.argv[2] || 10);
const offset = Number(process.argv[3] || 0);

const SKILLS = ['python', 'fastapi', 'pydantic', 'sqlalchemy', 'asyncio', 'httpx', 'rest', 'api',
  'sql', 'postgres', 'sqlite', 'docker', 'celery', 'redis', 'pytest', 'selenium', 'allure',
  'git', 'linux', 'ci', 'ruff', 'mypy', 'telegram', 'парсинг', 'автоматизация', 'rust', 'c++', 'c#'];

const resumeText = fs.existsSync('resume-fastapi.html')
  ? fs.readFileSync('resume-fastapi.html', 'utf8').replace(/<[^>]+>/g, ' ').toLowerCase()
  : '';

// Фильтр по стеку обязателен, а не «для красоты»: вакансия без стека — это
  // не ИТ-разработка, которая случайно набрала баллы за формат и свежесть.
  // Такие письма уходят людям, которым кандидат не подходит по профессии.
  const rows = db.prepare(`
  SELECT v.*,
    (SELECT COUNT(*) FROM contacts c WHERE c.company_key = v.company_key) AS contacts_n,
    (SELECT COUNT(*) FROM dispatches d WHERE d.vacancy_id = v.id AND d.status = 'sent') AS channels_n
  FROM vacancies v
  WHERE v.status IN ('scored', 'drafted') AND v.stack IS NOT NULL
  ORDER BY v.urgent DESC, v.percent DESC, v.valid_through ASC
  LIMIT ? OFFSET ?
`).all(limit, offset);

console.log(`патча: ${rows.length} вакансий (смещение ${offset}) — только со стеком\n`);

// Адресат выбирается здесь, а не в момент отправки: письмо, написанное «в
// никуда», а потом отправленное конкретному человеку, не совпадает с тем,
// что человек получит. Общие адреса площадок в адресаты не идут.
const shared = new Set(sharedEmails(db, 3).map((s) => s.value));

let saved = 0;
let flagged = 0;
let noTarget = 0;
for (const v of rows) {
  const why = v.fit_why ? JSON.parse(v.fit_why) : null;
  const contacts = db.prepare('SELECT kind, value, source_url, note FROM contacts WHERE company_key = ?').all(v.company_key);
  const site = contacts.find((c) => c.kind === 'site')?.value || '';
  const target = pickAddress(contacts, { site, shared });
  const contacts_n = contacts.length;
  if (target.blocked) noTarget++;
  const letter = draftLetter(v, {
    score: { stack: v.stack, percent: v.percent, parts: why?.parts || [] },
    target: target.blocked ? null : target,
  });

  // Перечитываем письмо и ловим обещания без опоры в резюме.
  const bad = checkClaims(letter, resumeText);
  if (bad.length) flagged++;

  db.prepare('DELETE FROM letters WHERE vacancy_id = ?').run(v.id);
  db.prepare(`
    INSERT INTO letters (vacancy_id, resume_stack, subject, body, fit_score, fit_why, created, status)
    VALUES (?,?,?,?,?,?,?, 'draft')
  `).run(
    v.id, resumeForStack(v.stack) || 'resume-fastapi.pdf', letter.subject, letter.body, v.percent,
    JSON.stringify({ parts: why?.parts || [], claims: bad, verdict: why?.verdict || '' }),
    new Date().toISOString(),
  );
  db.prepare("UPDATE vacancies SET status = 'drafted' WHERE id = ?").run(v.id);
  saved++;

  console.log(`${String(v.percent).padStart(3)} | ${v.title.slice(0, 46).padEnd(46)} | ${(v.company || '—').slice(0, 18)}`);
  if (bad.length) console.log(`      ⚠ ${bad.join('; ')}`);
  console.log(`      адресат: ${target.blocked ? `нет (${target.blocked})` : target.value} · контактов: ${contacts_n} · стек: ${v.stack || '—'}`);
}

console.log(`\nсохранено писем: ${saved} · с замечаниями: ${flagged} · без адресата: ${noTarget}`);
console.log(`порог отправки: ${THRESHOLD}`);
console.log('\nочереди:', JSON.stringify(Object.fromEntries(
  db.prepare('SELECT status, COUNT(*) c FROM vacancies GROUP BY status').all().map((r) => [r.status, r.c]),
)));

// Первый текст целиком — чтобы прочитать глазами, а не только по метрике.
if (rows.length) {
  const first = db.prepare('SELECT subject, body FROM letters ORDER BY id DESC LIMIT 1').get();
  console.log('\n=== пример письма ===');
  console.log('Тема:', first.subject);
  console.log('---');
  console.log(first.body);
}
