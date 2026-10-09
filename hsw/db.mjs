// HardSearchWork — слой базы данных.
//
// Одна SQLite, один файл, никаких сервисов. Причина именно такая: сборщик должен
// переживать перезапуски без потери уже собранного, а отправка — фиксироваться
// атомарно, чтобы после падения нельзя было отправить одно письмо дважды.
//
// node:sqlite встроен в Node 22+, поэтому зависимостей нет вообще.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isPlatformContact } from './target.mjs';

const SCHEMA_TABLE = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Вакансии. Одна строка — одно объявление на одном сайте.
CREATE TABLE IF NOT EXISTS vacancies (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL,              -- hh | habr | hirify | fl
  external_id   TEXT NOT NULL,              -- id вакансии на сайте
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  company       TEXT NOT NULL DEFAULT '',
  company_key   TEXT NOT NULL DEFAULT '',   -- нормализованное имя, для склейки дублей
  salary_from   INTEGER,
  salary_to     INTEGER,
  currency      TEXT,
  remote        INTEGER NOT NULL DEFAULT 0, -- 1 = удалённая
  no_experience INTEGER NOT NULL DEFAULT 0, -- 1 = «без опыта»
  no_degree     INTEGER NOT NULL DEFAULT 0, -- 1 = не требует высшего
  city          TEXT,
  schedule      TEXT,
  experience    TEXT,
  description   TEXT DEFAULT '',
  requirements  TEXT DEFAULT '',
  published     TEXT,
  valid_through TEXT,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new', -- new | scored | drafted | sent | rejected | leaks
  UNIQUE (source, external_id)
);
-- Скоринг хранится в самой вакансии, а не в письме: балл нужен для сортировки
-- в интерфейсе и для повторного расчёта, когда появились контакты.
-- Контакты. Пишем источник, чтобы потом можно было показать, откуда взялся адрес.
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY,
  company_key TEXT NOT NULL,
  vacancy_id  INTEGER,
  kind        TEXT NOT NULL,   -- email | telegram | site | hh_employer | vk | linkedin | phone
  value       TEXT NOT NULL,
  source_url  TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  first_seen  TEXT NOT NULL,
  UNIQUE (company_key, kind, value)
);
CREATE INDEX IF NOT EXISTS ix_con_key ON contacts (company_key);

-- Резюме: файлы из папки, проиндексированные по стеку.
CREATE TABLE IF NOT EXISTS resumes (
  id         INTEGER PRIMARY KEY,
  stack      TEXT NOT NULL,
  title      TEXT NOT NULL,
  file       TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '',  -- через запятую
  created    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_res_stack ON resumes (stack);

-- Письма. Пишутся, но не отправляются: отправка — действие человека.
CREATE TABLE IF NOT EXISTS letters (
  id          INTEGER PRIMARY KEY,
  vacancy_id  INTEGER NOT NULL REFERENCES vacancies (id) ON DELETE CASCADE,
  resume_id   INTEGER REFERENCES resumes (id),
  resume_stack TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  fit_score   INTEGER,
  fit_why     TEXT NOT NULL DEFAULT '',
  created     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'  -- draft | approved | sent
);
CREATE INDEX IF NOT EXISTS ix_let_vac ON letters (vacancy_id);

-- Куда уже отправляли. Один канал — одна строка, поэтому «отправлено ли» проверяется
-- запросом, а не догадкой.
CREATE TABLE IF NOT EXISTS dispatches (
  id          INTEGER PRIMARY KEY,
  vacancy_id  INTEGER NOT NULL REFERENCES vacancies (id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,   -- email | hh | habr | fl | hirify
  target      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,   -- prepared | queued | sent | failed | skipped
  sent_at     TEXT,
  note        TEXT NOT NULL DEFAULT '',
  UNIQUE (vacancy_id, channel)
);

-- Сигналы для расчёта вероятности: нашли ли живые контакты, сколько каналов
-- использовано по конкретной вакансии.
CREATE TABLE IF NOT EXISTS signals (
  vacancy_id INTEGER NOT NULL REFERENCES vacancies (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL DEFAULT '1',
  created    TEXT NOT NULL,
  UNIQUE (vacancy_id, kind)
);

-- Журнал прогонов: что искали, что нашли, что не сошлось.
CREATE TABLE IF NOT EXISTS runs (
  id       INTEGER PRIMARY KEY,
  started  TEXT NOT NULL,
  finished TEXT,
  stats    TEXT NOT NULL DEFAULT '{}'
);

-- Привязки: почта и площадки, через которые идёт работа.
--
-- Что здесь лежит и чего не должно: логин, отображаемое имя, дневной лимит и
-- результат последней проверки связи. Пароля здесь нет и быть не должно —
-- лежит имя переменной окружения (pass_env), в которой пароль уже стоит.
-- База уезжает на флешке и переписывается, пароль из неё уехал бы вместе с
-- ней; поэтому в форме привязки поле называется ПАРОЛЬ_ENV, а не «пароль».
CREATE TABLE IF NOT EXISTS accounts (
  id           INTEGER PRIMARY KEY,
  service      TEXT NOT NULL,   -- email | emailin | hh | hirify | fl | kwork | telegram | linkedin
  login        TEXT NOT NULL,   -- почта или логин в терминах площадки
  display      TEXT NOT NULL DEFAULT '',
  pass_env     TEXT NOT NULL DEFAULT '',  -- ИМЯ переменной окружения, не сам пароль
  daily_limit  INTEGER NOT NULL DEFAULT 20,
  enabled      INTEGER NOT NULL DEFAULT 1,
  note         TEXT NOT NULL DEFAULT '',
  last_checked TEXT,
  last_ok      INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT NOT NULL DEFAULT '',
  created      TEXT NOT NULL,
  UNIQUE (service, login)
);
`;

const SCHEMA_INDEXES = `
CREATE INDEX IF NOT EXISTS ix_vac_key   ON vacancies (company_key);
CREATE INDEX IF NOT EXISTS ix_vac_stat  ON vacancies (status);
CREATE INDEX IF NOT EXISTS ix_vac_seen  ON vacancies (last_seen);
CREATE INDEX IF NOT EXISTS ix_vac_pct   ON vacancies (percent);
CREATE INDEX IF NOT EXISTS ix_con_key   ON contacts (company_key);
CREATE INDEX IF NOT EXISTS ix_res_stack ON resumes (stack);
CREATE INDEX IF NOT EXISTS ix_let_vac   ON letters (vacancy_id);
CREATE INDEX IF NOT EXISTS ix_acc_service ON accounts (service);
`;

/**
 * Открыть базу.
 *
 * Порядок обязателен: сначала CREATE TABLE (он идемпотентен через IF NOT EXISTS),
 * затем миграция колонок — она смотрит в table_info уже существующей таблицы.
 * Наоборот сделать нельзя: ALTER TABLE на несуществующей таблице падает.
 */
export function openDb(file = 'hsw/hsw.sqlite') {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_TABLE);
  migrateColumns(db);
  db.exec(SCHEMA_INDEXES);
  return db;
}

function migrateColumns(db) {
  const columns = [
    ['percent', 'INTEGER'],
    ['stack', 'TEXT'],
    ['fit_why', "TEXT NOT NULL DEFAULT ''"],
    ['urgent', 'INTEGER NOT NULL DEFAULT 0'],
    ['sent_via', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  const present = new Set(db.prepare('PRAGMA table_info(vacancies)').all().map((c) => c.name));
  for (const [name, decl] of columns) {
    if (!present.has(name)) db.exec(`ALTER TABLE vacancies ADD COLUMN ${name} ${decl}`);
  }
}

export const now = () => new Date().toISOString();

/** Ключ компании: без ООО/ООП/ИП/кавычек, в нижнем регистре. */
export function companyKey(name) {
  return String(name || '')
    .replace(/&laquo;|&raquo;|«|»/g, '')
    .replace(/\s*(ООО|ОПФ|ОАО|ЗАО|ПАО|ИП|ГУП|МУП|ФГУП)\s*/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

/**
 * Вставить или обновить вакансию. Не перетирает статус: повторный сбор не должен
 * стирать отметку «уже отправлено» — это ровно тот баг, из-за которого письма
 * уходят дважды.
 */
export function upsertVacancy(db, v) {
  // Имя поля именно externalId: раньше здесь стояло v.external_id, которого в
  // объекте не существует, поэтому String(undefined) = 'undefined' совпадало само
  // с собой и все вакансии обновляли одну и ту же строку. База выглядела непустой
  // и при этом была пустой — молчаливый сбой, который читается как «рынок мёртв».
  const found = db
    .prepare('SELECT id, status FROM vacancies WHERE source = ? AND external_id = ?')
    .get(v.source, String(v.externalId));

  if (found) {
    db.prepare(`
      UPDATE vacancies SET
        title = ?, company = ?, company_key = ?, salary_from = ?, salary_to = ?,
        currency = ?, remote = ?, no_experience = ?, no_degree = ?, city = ?,
        schedule = ?, experience = ?, description = ?, requirements = ?,
        published = ?, valid_through = ?, last_seen = ?
      WHERE id = ?
    `).run(
      v.title, v.company, v.companyKey, v.salaryFrom ?? null, v.salaryTo ?? null,
      v.currency ?? null, v.remote ? 1 : 0, v.noExperience ? 1 : 0, v.noDegree ? 1 : 0,
      v.city ?? null, v.schedule ?? null, v.experience ?? null,
      v.description ?? '', v.requirements ?? '', v.published ?? null,
      v.validThrough ?? null, now(), found.id,
    );
    return { id: found.id, created: false };
  }

  const info = db.prepare(`
    INSERT INTO vacancies (source, external_id, url, title, company, company_key,
      salary_from, salary_to, currency, remote, no_experience, no_degree, city,
      schedule, experience, description, requirements, published, valid_through,
      first_seen, last_seen, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new')
  `).run(
    v.source, String(v.externalId), v.url, v.title, v.company, v.companyKey,
    v.salaryFrom ?? null, v.salaryTo ?? null, v.currency ?? null,
    v.remote ? 1 : 0, v.noExperience ? 1 : 0, v.noDegree ? 1 : 0, v.city ?? null,
    v.schedule ?? null, v.experience ?? null, v.description ?? '',
    v.requirements ?? '', v.published ?? null, v.validThrough ?? null, now(), now(),
  );
  return { id: Number(info.lastInsertRowid), created: true };
}

export function addContact(db, c) {
  // Контакт площадки не контакт компании: страница работодателя на hh — это
  // страница hh, и её телеграм (@hh_ru_official), сайт сервиса
  // (setka.ru/communities/…) и служебные телефоны попадали в бау тем же
  // кодом, что и настоящие контакты, и выглядели неотличимо.
  // Проверка стоит здесь, а не в сборщике: инвариант «в базе нет контакта
  // площадки» должен держаться независимо от того, какой скрипт пишет.
  if (isPlatformContact(c.value, c.kind)) return false;
  const res = db.prepare(`
    INSERT OR IGNORE INTO contacts (company_key, vacancy_id, kind, value, source_url, note, first_seen)
    VALUES (?,?,?,?,?,?,?)
  `).run(c.companyKey, c.vacancyId ?? null, c.kind, c.value, c.sourceUrl ?? '', c.note ?? '', now());
  return res.changes > 0;
}

export function addSignal(db, vacancyId, kind, value = '1') {
  db.prepare('INSERT OR IGNORE INTO signals (vacancy_id, kind, value, created) VALUES (?,?,?,?)')
    .run(vacancyId, kind, String(value), now());
}

// ------------------------------------------------------------ отправки
//
// Таблица dispatches существовала с самого начала, но её никто не писал:
// вкладка «Отправлено» в интерфейсе была всегда пустой, а скоринг считал
// использованные каналы (`channels_n`) по ней — то есть 15 баллов за
// «вакансия не забыта после первого канала» не начислялись никогда.
// Писать в неё научился только send.mjs.

/**
 * Записать отправку. Статус меняется по месту: prepared → queued → sent/failed.
 * Письмо считается отправленным только после подтверждения, поэтому
 * prepared никогда не превращается в sent сам.
 */
export function recordDispatch(db, { vacancyId, channel, target = '', status, note = '', sentAt = null }) {
  db.prepare(`
    INSERT INTO dispatches (vacancy_id, channel, target, status, sent_at, note)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT (vacancy_id, channel) DO UPDATE SET
      target = excluded.target,
      status = excluded.status,
      sent_at = COALESCE(excluded.sent_at, dispatches.sent_at),
      note = excluded.note
  `).run(vacancyId, channel, target, status, sentAt, note);

  // Вакансия уходит в статус sent только когда письмо действительно ушло,
  // и письмо помечается тем же, что и сама отправка.
  if (status === 'sent') {
    db.prepare("UPDATE vacancies SET status = 'sent' WHERE id = ?").run(vacancyId);
    db.prepare("UPDATE letters SET status = 'sent' WHERE vacancy_id = ?").run(vacancyId);
  } else if (status === 'queued' || status === 'prepared') {
    db.prepare("UPDATE letters SET status = 'approved' WHERE vacancy_id = ?").run(vacancyId);
  }
}

export function dispatchFor(db, vacancyId) {
  return db.prepare('SELECT * FROM dispatches WHERE vacancy_id = ?').all(vacancyId);
}

/**
 * Адреса, встречающиеся у нескольких компаний сразу.
 *
 * Так выглядит ящик площадки-агрегатора: DreamJob печатает свой адрес в
 * блоке «Откликнуться» на странице любой вакансии, и сборщик честно записал
 * employers@dreamjob.ru в 12 компаний подряд. Отправка письма «в компанию
 * Иктин Групп» на этот адрес — это письмо в DreamJob про Иктин Групп: один
 * получатель на двенадцать «разных» компаний, то есть спам с чужой подписью.
 * Такие адреса не удаляются (данные собраны верно), а помечаются как общие и
 * не выбираются адресатом.
 */
export function sharedEmails(db, minCompanies = 3) {
  return db.prepare(`
    SELECT value, COUNT(DISTINCT company_key) AS companies
    FROM contacts WHERE kind = 'email'
    GROUP BY value HAVING companies >= ?
    ORDER BY companies DESC
  `).all(minCompanies);
}

/** Пометить общие адреса в контактах, чтобы это было видно и в интерфейсе. */
export function flagSharedContacts(db, minCompanies = 3) {
  const shared = sharedEmails(db, minCompanies);
  const upd = db.prepare("UPDATE contacts SET note = ? WHERE kind = 'email' AND value = ? AND note = ''");
  for (const s of shared) upd.run(`общий адрес площадки — у ${s.companies} компаний, адресатом не выбирается`, s.value);
  return shared;
}

/** Адреса одной компании — их немного, они и есть кандидаты в адресаты. */
export function contactTargets(db, companyKey) {
  return db.prepare('SELECT kind, value, source_url, note FROM contacts WHERE company_key = ?').all(companyKey);
}

export function stats(db) {
  // Приведение к числу на границе: node:sqlite отдаёт integer, но любое
  // неожиданное значение не должно превращать весь отчёт в NaN.
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const one = (sql, ...p) => db.prepare(sql).get(...p) || {};
  return {
    vacancies: num(one('SELECT COUNT(*) c FROM vacancies').c),
    remote: num(one('SELECT COUNT(*) c FROM vacancies WHERE remote = 1').c),
    noExperience: num(one('SELECT COUNT(*) c FROM vacancies WHERE no_experience = 1').c),
    noDegree: num(one('SELECT COUNT(*) c FROM vacancies WHERE no_degree = 1').c),
    matching: num(one('SELECT COUNT(*) c FROM vacancies WHERE remote = 1 AND no_experience = 1 AND no_degree = 1').c),
    contacts: num(one('SELECT COUNT(*) c FROM contacts').c),
    companies: num(one('SELECT COUNT(DISTINCT company_key) c FROM contacts').c),
    letters: num(one('SELECT COUNT(*) c FROM letters').c),
    sent: num(one("SELECT COUNT(*) c FROM dispatches WHERE status = 'sent'").c),
    // Суммирование в SQL вместо чтения undefined на стороне JS: пустой COUNT
    // в node:sqlite возвращает число, но если колонка ещё не мигрировала —
    // приходит undefined, и в сводке появляется «NaN шт.». Такой вывод читается
    // как «счётчик сломан», хотя сломан был только вывод.
    queues: {
      new: num(one("SELECT COUNT(*) c FROM vacancies WHERE status = 'new'").c),
      scored: num(one("SELECT COUNT(*) c FROM vacancies WHERE status = 'scored'").c),
      drafted: num(one("SELECT COUNT(*) c FROM vacancies WHERE status = 'drafted'").c),
      sent: num(one("SELECT COUNT(*) c FROM vacancies WHERE status = 'sent'").c),
      rejected: num(one("SELECT COUNT(*) c FROM vacancies WHERE status = 'rejected'").c),
      leaks: num(one("SELECT COUNT(*) c FROM vacancies WHERE status = 'leaks'").c),
    },
  };
}
