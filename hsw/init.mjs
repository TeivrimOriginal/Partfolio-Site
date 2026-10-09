// Инициализация: проверяет, что система готова к работе, и показывает что готово,
// а что нет. Ничего не «подключает за пользователя» молча — только проверяет.
//
// Что проверяется и почему именно это:
//   * база и её целостность      — без неё всё остальное бессмысленно;
//   * вакансии под фильтры       — если их 0, скоринг и письма нечего делать;
//   * контакты                   — их отсутствие режет процент приёма сильнее
//                                  всего остального вместе взятого;
//   * резюме на диске            — к ним привязывается выбор версии под стек;
//   * почтовые ящики             — СМТП-реквизиты читаются из конфига, пароли
//                                  в базу не кладутся;
//   * сессии браузера            — только проверка файлов cookie, без чтения
//                                  содержимого и без подмены пользователя.

import fs from 'node:fs';
import path from 'node:path';
import { openDb, stats } from './db.mjs';
import { resumeForStack } from './resumes.mjs';

const ROOT = process.cwd();
const OK = '[ok]';
const WARN = '[внимание]';
const FAIL = '[нет]';

const line = (mark, title, detail = '') => console.log(`${mark.padEnd(11)} ${title}${detail ? ' — ' + detail : ''}`);

const db = openDb();
console.log('HardSearchWork — проверка готовности\n');

// ------------------------------------------------------------------ база
const s = stats(db);
line(s.vacancies > 0 ? OK : FAIL, 'база данных', `${s.vacancies} вакансий, ${s.contacts} контактов`);

// --------------------------------------------------------------- вакансии
line(s.matching > 0 ? OK : FAIL, 'вакансии под фильтры (удалённо + без опыта + без вышки)', String(s.matching));
// Счётчики очередей лежат в s.queues, а не в s напрямую. Раньше читалось
// s.scored — такого ключа нет, выходил undefined, и в сводке печаталось «NaN».
// Число счётчика не должно молча превращаться в NaN: читатель видит «счётчик
// сломан» и не понимает, сломана база или вывод.
const q = s.queues;
const passed = q.scored + q.drafted;
line(passed > 0 ? OK : WARN, 'прошли порог 50', `${passed} шт., в LeaksData ${q.leaks}`);

// --------------------------------------------------------------- контакты
const contactKinds = db.prepare('SELECT kind, COUNT(*) c FROM contacts GROUP BY kind ORDER BY c DESC').all();
const withContacts = db.prepare(`
  SELECT COUNT(DISTINCT company_key) c FROM contacts
`).get().c;
const companies = db.prepare('SELECT COUNT(DISTINCT company_key) c FROM vacancies').get().c;
line(withContacts > 0 ? OK : WARN, 'контакты компаний',
  `${withContacts} из ${companies} компаний${contactKinds.length ? ' (' + contactKinds.map((k) => `${k.kind}: ${k.c}`).join(', ') + ')' : ''}`);

// ------------------------------------------------------------- отправки
// Пока отправок нет, половина баллов скоринга («использованные каналы»)
// не начисляется никому. Пустая таблица — не «всё хорошо», а «отправка не
// начиналась»: пусто и одинаково у того, кто отправлял, и кто нет.
const dispatches = db.prepare('SELECT status, COUNT(*) c FROM dispatches GROUP BY status').all();
line(dispatches.some((d) => d.status === 'sent') ? OK : WARN, 'отправки',
  dispatches.length ? dispatches.map((d) => `${d.status}=${d.c}`).join(', ') : 'ни одной — node hsw/send.mjs --report покажет, что готово');

// ----------------------------------------------------------------- резюме
// Проверяется не список файлов, а соответствие «стек → резюме»: список из
// пяти файлов в этом модуле разошёлся с диском (devops и data в нём не были
// упомянуты, хотя файлы есть), а интерфейс из-за того же расхождения
// прикладывал к QA-вакансии FastAPI-резюме. Здесь тот же выбор, что и при
// отправке, — resumes.mjs.
const RESUME_STACKS = ['Python', 'Backend', 'QA / тестирование', 'DevOps', 'Данные', 'frontend', 'cpp'];
const present = RESUME_STACKS.filter((s) => resumeForStack(s, { root: ROOT }));
line(present.length > 0 ? OK : WARN, 'резюме на диске',
  `${present.length} из ${RESUME_STACKS.length}: ${present.map((s) => `${s} → ${resumeForStack(s, { root: ROOT })}`).join(', ') || '—'}`);

// --------------------------------------------------------------- почта
// Реквизиты читаются из переменных окружения или из файла, который человек
// заполняет сам. Ничего не отправляется и ничего не логируется.
const MAIL_KEYS = ['HSW_SMTP_HOST', 'HSW_SMTP_PORT', 'HSW_SMTP_USER', 'HSW_MAIL_FROM'];
const mailFile = path.join(ROOT, 'hsw', 'mailboxes.txt');
const fromFile = fs.existsSync(mailFile)
  ? fs.readFileSync(mailFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
const envKeys = MAIL_KEYS.filter((k) => process.env[k]);
line(envKeys.length === MAIL_KEYS.length || fromFile.length > 0 ? OK : WARN, 'почта для отправки',
  envKeys.length ? `переменные окружения: ${envKeys.length}/4` : fromFile.length ? `файл hsw/mailboxes.txt: ${fromFile.length} шт.` : 'СМТП не настроен — send.mjs подготовит письма, но не отправит их сам');

// -------------------------------------------------------------- сессии
// Только факт наличия файлов. Содержимое cookie не читается: подмена сессии
// пользователя — это использование аккаунта вместо него, и на hh это бан.
const SESSION_PATHS = {
  'Chrome (профиль по умолчанию)': path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies'),
  'Chrome (профиль 1)': path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Profile 1', 'Network', 'Cookies'),
  'Edge': path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data', 'Default', 'Network', 'Cookies'),
  'Firefox': path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles'),
};
const sessions = Object.entries(SESSION_PATHS).filter(([, p]) => p && fs.existsSync(p));
line(sessions.length ? OK : WARN, 'файлы сессий браузера',
  sessions.length ? sessions.map(([n, p]) => `${n}: ${fs.statSync(p).isDirectory() ? 'найдено' : Math.round(fs.statSync(p).size / 1024) + ' КБ'}`).join('; ') : 'не найдены');
console.log('           сессии не импортируются и не используются — только факт наличия');

// ----------------------------------------------------------------- вывод
console.log('\nЧто можно делать сейчас:');
const can = [];
if (s.vacancies > 0) can.push('сортировать вакансии по проценту (node hsw/run-score.mjs)');
if (s.matching > 0) can.push('генерировать письма партиями по 10 (node hsw/run-letters.mjs 10 0)');
if (withContacts < companies) can.push('добирать контакты компаний (node hsw/collect-contacts.mjs 20)');
if (s.letters > 0) can.push('подготовить письма к отправке (node hsw/send.mjs --batch 10)');
can.push('открыть интерфейс (node hsw/ui.mjs) — вкладки Очередь, Письма, Контакты, LeaksData');
for (const c of can) console.log(`  • ${c}`);

const blockers = [];
if (s.vacancies === 0) blockers.push('нет вакансий — запусти node hsw/collect.mjs');
if (withContacts === 0) blockers.push('нет ни одного контакта — процент приёма будет низкий на любой вакансии');
if (blockers.length) {
  console.log('\nЧто мешает:');
  for (const b of blockers) console.log(`  ! ${b}`);
}
console.log('\nОтправка — действие человека: send.mjs готовит письмо с вложенным резюме и адресатом,');
console.log('нажатие «отправить» — в его почте. Подробности: HSW-SEND.md.');
