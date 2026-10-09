// Полный цикл HardSearchWork одной командой: сбор → скоринг → контакты → письма.
//
// Порядок не выбран произвольно: контакты собираются **до** скоринга, потому что
// их наличие — 15 баллов из 100 и прямой признак того, дойдёт ли письмо.
// Считать сначала, потом искать контакты — значит показать заниженный процент
// и отправить письмо в компанию, куда нечем писать.
//
// Письма генерируются на вакансии, прошедшие порог, партиями по 10.

import fs from 'node:fs';
import { openDb, stats, sharedEmails } from './db.mjs';
import { collectHh, ingestHabr } from './collect.mjs';
import { collectHabr } from './collect-habr.mjs';
import { contactsFor } from './collect-contacts.mjs';
import { draftLetter, checkClaims } from './letters.mjs';
import { resumeForStack } from './resumes.mjs';
import { pickAddress } from './target.mjs';
import { scoreVacancy, THRESHOLD } from './score.mjs';

const args = process.argv.slice(2);
const batch = Number(args[0] || 10);
const doHabr = !args.includes('--no-habr');
const doCollect = !args.includes('--score-only');

const db = openDb();
const started = new Date();
console.log(`HardSearchWork — цикл запущен ${started.toISOString().slice(11, 19)}\n`);

// ------------------------------------------------------------- 1. сбор
if (doCollect) {
  console.log('1. Собираю hh…');
  const hh = await collectHh(db, { pages: 3, verbose: false });
  console.log(`   карточек ${hh.cards}, новых ${hh.created}`);
  console.log('   отсеяно: ' + JSON.stringify(hh.byReason));
}

if (doHabr) {
  console.log('\n2. Собираю Хабр Карьеру…');
  const h = await collectHabr({ maxPages: 8, verbose: false });
  const ing = await ingestHabr(db, h.list, { verbose: false });
  console.log(`   карточек ${h.list.length}, под фильтры попало в базу ${ing.created}, отсеяно ${ing.skipped}`);
}

// ---------------------------------------------------------- 2. контакты
// По всем новым вакансиям без контактов — ограниченно, чтобы не уходить в
// получасовой обход сайтов.
console.log('\n3. Собираю контакты компаний…');
const needContacts = db.prepare(`
  SELECT v.* FROM vacancies v
  WHERE v.remote = 1
    AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.company_key = v.company_key)
  ORDER BY v.last_seen DESC LIMIT 25
`).all();

let contactsAdded = 0;
for (const v of needContacts) {
  const r = await contactsFor(db, v);
  contactsAdded += r.found;
}
console.log(`   компаний без контактов было ${needContacts.length}, добавлено записей ${contactsAdded}`);

// ----------------------------------------------------------- 3. скоринг
console.log('\n4. Считаю проценты…');
const SKILLS = ['python', 'fastapi', 'pydantic', 'sqlalchemy', 'asyncio', 'httpx', 'rest', 'api',
  'sql', 'postgres', 'sqlite', 'docker', 'celery', 'redis', 'pytest', 'selenium', 'allure',
  'git', 'linux', 'ci', 'ruff', 'mypy', 'telegram', 'парсинг', 'автоматизация', 'rust', 'c++', 'c#'];
const resumeText = fs.existsSync('resume-fastapi.html')
  ? fs.readFileSync('resume-fastapi.html', 'utf8').replace(/<[^>]+>/g, ' ').toLowerCase() : '';

const all = db.prepare(`
  SELECT v.*,
    (SELECT COUNT(*) FROM contacts c WHERE c.company_key = v.company_key) AS contacts_n,
    (SELECT COUNT(*) FROM dispatches d WHERE d.vacancy_id = v.id AND d.status='sent') AS channels_n
  FROM vacancies v
`).all();

const upd = db.prepare('UPDATE vacancies SET percent=?, stack=?, fit_why=?, urgent=?, status=? WHERE id=?');
let high = 0, mid = 0, low = 0;
for (const v of all) {
  const s = scoreVacancy(v, { resumeSkills: SKILLS, contactCount: v.contacts_n || 0, channelCount: v.channels_n || 0 });
  if (s.percent >= 75) high++;
  else if (s.percent >= THRESHOLD) mid++;
  else low++;
  upd.run(s.percent, s.stack || null,
    JSON.stringify({ parts: s.parts, matched: s.matched, missing: s.missing, verdict: s.verdict }),
    s.urgent ? 1 : 0, s.passed ? 'scored' : 'leaks', v.id);
}
console.log(`   >=75: ${high} · ${THRESHOLD}-74: ${mid} · <${THRESHOLD}: ${low}`);

// ------------------------------------------------------------ 4. письма
console.log(`\n5. Пишу письма, партия по ${batch}…`);
// Фильтр по стеку здесь был один раз и не работает: запрос в этой версии шёл
// по всем drafted, и в партию попадали «Retention manager (iGaming)»,
// «Программист 1С» и «Ассистент менеджера по продажам Битрикс24» — вакансии,
// которые скоринг уже признал не-разработкой. run-letters.mjs такой фильтр
// имеет, cycle.mjs — нет, и цикл писал письма не по адресу.
const rows = db.prepare(`
  SELECT v.*,
    (SELECT COUNT(*) FROM contacts c WHERE c.company_key = v.company_key) AS contacts_n
  FROM vacancies v WHERE v.status IN ('scored','drafted')
    AND v.stack IS NOT NULL AND v.percent >= ?
  ORDER BY v.urgent DESC, v.percent DESC, v.valid_through ASC LIMIT ?
`).all(THRESHOLD, batch);

const shared = new Set(sharedEmails(db, 3).map((s) => s.value));
let letters = 0;
let flagged = 0;
for (const v of rows) {
  let why = {};
  try { why = JSON.parse(v.fit_why || '{}'); } catch { /* пусто */ }
  const contacts = db.prepare('SELECT kind, value, source_url, note FROM contacts WHERE company_key = ?').all(v.company_key);
  const target = pickAddress(contacts, { site: contacts.find((c) => c.kind === 'site')?.value || '', shared });
  const letter = draftLetter(v, { score: { stack: v.stack, percent: v.percent }, target: target.blocked ? null : target });
  const bad = checkClaims(letter, resumeText);
  if (bad.length) flagged++;

  db.prepare('DELETE FROM letters WHERE vacancy_id = ?').run(v.id);
  db.prepare(`
    INSERT INTO letters (vacancy_id, resume_stack, subject, body, fit_score, fit_why, created, status)
    VALUES (?,?,?,?,?,?,?, 'draft')
  `).run(v.id, resumeForStack(v.stack) || 'resume-fastapi.pdf', letter.subject, letter.body, v.percent,
    JSON.stringify({ parts: why.parts || [], claims: bad, verdict: why.verdict || '' }),
    new Date().toISOString());
  db.prepare("UPDATE vacancies SET status='drafted' WHERE id = ?").run(v.id);
  letters++;
  console.log(`   ${String(v.percent).padStart(3)} | ${v.title.slice(0, 44).padEnd(44)} | ${(target.blocked ? 'адресата нет' : target.value).padEnd(26)} контактов ${contacts.length}${bad.length ? ' ⚠ ' + bad.join('; ') : ''}`);
}

// ------------------------------------------------------------- итог
const s = stats(db);
const sec = Math.round((Date.now() - started.getTime()) / 1000);
console.log(`\nГотово за ${sec} с`);
console.log(`  вакансий ${s.vacancies} (под фильтры ${s.matching}) · контактов ${s.contacts} по ${s.companies} компаниям`);
console.log(`  писем ${s.letters} (из них с замечаниями ${flagged}) · LeaksData ${s.queues.leaks}`);
console.log(`\nДальше: node hsw/ui.mjs — письма лежат во вкладке «Письма», копируются кнопкой.`);
console.log('Отправка — твоё действие.');
