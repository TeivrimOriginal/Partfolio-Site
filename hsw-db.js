// Схема базы HardSearchWork.
//
// Зачем SQLite, а не JSON-файлы. Вся экономия ресурсов во второй итерации
// держится на одном: перед тем как искать компанию заново, нужно за секунды
// спросить «мы её уже видели». С JSON это линейный проход по файлу и риск
// задвоить компанию. С индексом по нормализованному имени это SELECT.
//
// Что здесь лежит и почему именно так:
//
// companies   — компании. Ключ dedup — norm, это имя в нижнем регистре без
//              ООО/АО/ЗАО и прочих форм. Без него «ООО Ромашка» и «Ромашка» —
//              две разные компании, и на каждую пойдёт своя рассылка.
// contacts    — найденные контакты. kind = public_business ТОЛЬКО для публичных
//              рабочих адресов и публичных аккаунтов. Личные адреса вида
//              baranova-1962@mail.ru в эту таблицу не пишутся, см. тест.
// vacancies  — вакансии, с ключом по площадке и id.
// resumes    — папка резюме по стекам, fit считается по совпадению стека.
// letters    — сгенерированные письма и их длина.
// applications — что куда и когда отправлено. Одно место для вкладки
//              «Отправленные», чтобы не собирать её из четырёх файлов.
// sessions   — выгрузка сессий площадок, чтобы вкладка «Сессии» читала базу.
// mailbox    — почты для рассылки, пароли хранятся как имена переменных
//              окружения, а не как пароли.
// leaks      — вакансии с fit ниже порога. Это не мусор: к ним возвращаются,
//              когда у него появится опыт или резюме под стек.
//
// Все индексы под конкретные вопросы, которые код задаёт чаще всего, и каждый
// помечен вопросом, который он закрывает. Индекс без вопроса — мусор.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- Компании. dedup по norm: «ООО Ромашка» и «Ромашка» должны стать одной строкой.
CREATE TABLE IF NOT EXISTS companies (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,            -- как написано в вакансии
  norm          TEXT NOT NULL UNIQUE,     -- для поиска дублей
  hh_id         TEXT,                     -- id на hh, если известен
  hh_url        TEXT,
  site          TEXT,                     -- домен площадки
  city          TEXT,
  size          TEXT,
  about         TEXT,                     -- описание компании, если нашли
  first_seen    TEXT NOT NULL,            -- когда впервые встретили
  last_seen     TEXT NOT NULL,
  source        TEXT,                     -- какая площадка первой дала
  fully_collected INTEGER NOT NULL DEFAULT 0  -- 1 = все контакты собраны
);
CREATE INDEX IF NOT EXISTS ix_companies_norm ON companies(norm);
CREATE INDEX IF NOT EXISTS ix_companies_site ON companies(site);
-- Вопрос: «мы эту компанию уже полностью обшарили?» — самая частая проверка
-- перед началом итерации, иначе контакты собираются дважды.
CREATE INDEX IF NOT EXISTS ix_companies_collected ON companies(fully_collected, last_seen);

-- Контакты. Только публичные деловые: адреса HR-отдела, ссылки на профили,
-- публичные аккаунты. Проверка на личные адреса — в test-contacts-policy.js.
CREATE TABLE IF NOT EXISTS contacts (
  id           INTEGER PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,             -- public_business | profile | account
  value        TEXT NOT NULL,             -- адрес, URL или @ник
  channel      TEXT NOT NULL,             -- email | hh | telegram | linkedin | phone | site
  role         TEXT,                      -- hr | recruiter | lcto — если известно
  is_public    INTEGER NOT NULL DEFAULT 1,-- всегда 1: личные контакты сюда не пишутся
  found_via    TEXT,                      -- откуда нашли: страница вакансии, careers, LinkedIn
  created_at   TEXT NOT NULL,
  UNIQUE(company_id, channel, value)
);
CREATE INDEX IF NOT EXISTS ix_contacts_company ON contacts(company_id, channel);
-- Вопрос: «нашли ли мы личный контакт HR?» — это половина формулы процента.
CREATE INDEX IF NOT EXISTS ix_contacts_role ON contacts(company_id, role);

-- Вакансии. dedup по (site, site_id): тот же id на разных площадках — разные
-- вакансии, а один id на одной площадке переезжает и обновляет ту же строку.
CREATE TABLE IF NOT EXISTS vacancies (
  id            INTEGER PRIMARY KEY,
  site          TEXT NOT NULL,            -- hh | habr | hirify | kwork | fl | linkedin
  site_id       TEXT NOT NULL,
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  company_raw   TEXT,
  remote        INTEGER NOT NULL DEFAULT 0,
  no_experience INTEGER NOT NULL DEFAULT 0,  -- требования опыта не мешают
  no_education  INTEGER NOT NULL DEFAULT 0,  -- высшего образования не требуют
  salary_from   INTEGER,
  stack         TEXT,                      -- python | qa | devops | backend | cpp | frontend
  experience_floor_months INTEGER,        -- нижняя граница опыта в месяцах
  description   TEXT,
  requirements  TEXT,                      -- что именно требуют
  published     TEXT,
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL,
  is_open       INTEGER NOT NULL DEFAULT 1,
  UNIQUE(site, site_id)
);
CREATE INDEX IF NOT EXISTS ix_vacancies_filter ON vacancies(is_open, remote, no_experience, no_education);
CREATE INDEX IF NOT EXISTS ix_vacancies_company ON vacancies(company_id);
CREATE INDEX IF NOT EXISTS ix_vacancies_stack ON vacancies(stack, is_open);
-- Вопрос: «есть ли ещё живые вакансии под этот стек?» — выборка очереди.
CREATE INDEX IF NOT EXISTS ix_vacancies_seen ON vacancies(last_seen);

-- Резюме по стекам. Источник правды о том, что приложение умеет предъявить.
CREATE TABLE IF NOT EXISTS resumes (
  id         INTEGER PRIMARY KEY,
  stack      TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  file       TEXT NOT NULL,
  public_url TEXT,
  ready      INTEGER NOT NULL DEFAULT 0,  -- 1 = создано на площадке
  tokens     TEXT                         -- что покрывает, через запятую, для fit
);

-- Сгенерированные письма. Хранятся целиком, потому что отправка идёт позже
-- и письмо должно уйти ровно тем текстом, который был проверен.
CREATE TABLE IF NOT EXISTS letters (
  id          INTEGER PRIMARY KEY,
  vacancy_id  INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  resume_id   INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  length      INTEGER NOT NULL,
  fit         INTEGER NOT NULL DEFAULT 0,   -- процент 0..100
  fit_why     TEXT,
  state       TEXT NOT NULL DEFAULT 'draft', -- draft | ready | sent | skipped | bad
  created_at  TEXT NOT NULL,
  sent_at     TEXT,
  channel     TEXT                          -- где отправлено: hh | email | habr
);
CREATE INDEX IF NOT EXISTS ix_letters_vacancy ON letters(vacancy_id);
CREATE INDEX IF NOT EXISTS ix_letters_state ON letters(state, created_at);
-- Вопрос: «что готово к отправке?» и «что ушло?» — две выборки на каждую итерацию.
CREATE INDEX IF NOT EXISTS ix_letters_fit ON letters(fit, state);

-- Отправки. Одно место для вкладки «Отправленные», вместо чтения четырёх файлов.
CREATE TABLE IF NOT EXISTS applications (
  id          INTEGER PRIMARY KEY,
  vacancy_id  INTEGER REFERENCES vacancies(id) ON DELETE SET NULL,
  letter_id   INTEGER REFERENCES letters(id) ON DELETE SET NULL,
  company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  site        TEXT NOT NULL,               -- hh | email | habr | kwork | fl
  channel     TEXT NOT NULL,               -- конкретный адрес или профиль
  target      TEXT NOT NULL,               -- куда именно
  subject     TEXT,
  body_hash   TEXT,
  resume_file TEXT,
  sent_at     TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,  -- 1 = подтверждено площадкой
  proof       TEXT,                        -- чем подтверждено: id отклика, id письма
  error       TEXT
);
CREATE INDEX IF NOT EXISTS ix_applications_sent ON applications(sent_at, ok);
CREATE INDEX IF NOT EXISTS ix_applications_vacancy ON applications(vacancy_id);

-- Сессии площадок. Вкладка «Сессии» читает отсюда, а не лезет в браузер.
CREATE TABLE IF NOT EXISTS sessions (
  site         TEXT PRIMARY KEY,
  logged_in    INTEGER NOT NULL DEFAULT 0,
  account      TEXT,
  checked_at   TEXT NOT NULL,
  cookie_names TEXT,                       -- имена кук, без значений
  check_how    TEXT,                       -- какой пробой определяли
  tab_id       TEXT
);

-- Почты для рассылки. pass_env — ИМЯ переменной окружения, не сам пароль:
-- иначе база с контактами работодателей лежала бы рядом с паролями.
CREATE TABLE IF NOT EXISTS mailboxes (
  name         TEXT PRIMARY KEY,
  user         TEXT NOT NULL,
  host         TEXT NOT NULL,
  port         INTEGER NOT NULL,
  daily_limit  INTEGER NOT NULL DEFAULT 20,
  pass_env     TEXT NOT NULL,
  display_name TEXT,
  usable       INTEGER NOT NULL DEFAULT 0,  -- 1 = пароль есть в окружении
  checked_at   TEXT
);

-- LeaksData: вакансии, куда не пошли. Не удаляются никогда — к ним возвращаются.
CREATE TABLE IF NOT EXISTS leaks (
  id         INTEGER PRIMARY KEY,
  vacancy_id INTEGER NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  fit        INTEGER NOT NULL,
  why        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(vacancy_id)
);
CREATE INDEX IF NOT EXISTS ix_leaks_fit ON leaks(fit);

-- Журнал итераций: что за цикл, что нашли, что отправили. По нему видно
-- прогресс и видно, что цикл упал, а не «молча отработал».
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  stage       TEXT,                        -- init | collect | draft | send
  found       INTEGER DEFAULT 0,
  drafted     INTEGER DEFAULT 0,
  sent        INTEGER DEFAULT 0,
  skipped     INTEGER DEFAULT 0,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS ix_runs_started ON runs(started_at);
`;

// Открывает базу и создаёт схему, если её нет.
function open(file) {
  const full = file || path.join(__dirname, 'hardsearchwork.db');
  const fresh = !fs.existsSync(full);
  const db = new DatabaseSync(full);
  db.exec(SCHEMA);
  if (fresh) {
    // WAL оставляет рядом -wal и -shm: их удалять нельзя, пока база открыта.
    db.exec('VACUUM;');
  }
  return db;
}

// Убирает форму из имени компании, чтобы «ООО Ромашка» и «Ромашка» совпали.
// Без этого дубль компании означает вторую рассылку тем же людям.
//
// ВАЖНО, здесь границы слов заданы руками, а не через \b. В JavaScript \b
// работает только по ASCII, кириллица к word-символам не относится: «ооо»
// с \b-границами не вырезалось ни разу, и пять форм одного имени давали пять
// компаний. Это уже третий случай этого класса в проекте (hh-target.js,
// hh-letter.js, здесь) — латинское слово «бот» находилось внутри «разработчик».
const CYR = 'а-яё';
// Латиница в кириллицу. На hh и на Хабре одно и то же имя пишут и так, и так:
// «Ooo Romashka» и «ООО Ромашка» — одна компания, а без перевода это две строки
// и две рассылки одним и тем же людям.
const LAT2CYR = {
  a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й',
  k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т',
  u: 'у', v: 'в', w: 'в', x: 'х', y: 'ы', z: 'з',
};

// Слова, которые не переводим: транслитерация брендов и имён тут не нужна, а вот
// latin-токены вида ios, crm, 1c оставим буквами, они различают компании.
const KEEP_LATIN = /\b(ios|macos|crm|erp|it|dev|ops|qa|ux|ui|api|hr|cv|3d|2d|1c|seo|smm|iso|gis|ip|b2b|b2c)\b/gi;

// Двухбуквенные сочетания латиницы. Без них «Romashka» даёт «ромасхка»:
// sh — это две буквы, и «с» + «х» не равно «ш». Здесь же «y» в начале слова:
// в «Yandex» это «й», а не «ы».
const DIGRAPH = {
  sh: 'ш', ch: 'ч', ts: 'ц', cs: 'с', zs: 'з', ks: 'кс', ps: 'пс',
  ya: 'я', yu: 'ю', yo: 'ё', ye: 'е', yi: 'и', ky: 'ки', kj: 'кй', kh: 'х', gh: 'г',
  q: 'к', w: 'в', eu: 'э', au: 'ау', ou: 'оу',
};

// Бренды, у которых написание латиницей и кириллицей не сводится переводом по
// буквам. Это не лень и не костыль: транслитерация физически не может дать
// «Яндекс» из «Yandex» (нужно ya→я, а не y→ы) и не должна превращать «X5 Tech»
// в «кс5 теч», потому что x — это «кс» в конце слова и «икс» в начале бренда.
//
// Список закрытый и расширяется только по факту: под каждую новую компанию,
// которая пришла с двух площадок в двух написаниях, добавляется строка.
// Альтернатива — угадывать правило, и оно будет ломаться на следующем бренде.
//
// Ключ — нормализованная латиница, значение — каноническая кириллица.
const BRAND_ALIAS = {
  yandex: 'яндекс',
  yandexd: 'яндекс',
  yandexeda: 'яндекс еда',
  yandexgo: 'яндекс го',
  yandexpracticum: 'яндекс практикум',
  vk: 'вк',
  vkontakte: 'вк',
  ozon: 'озон',
  ozonbank: 'озон банк',
  ozontech: 'озон тех',
  sber: 'сбер',
  sberbank: 'сбербанк',
  sbertech: 'сбер тех',
  tinkoff: 'тинкофф',
  tbank: 'тбанк',
  vtbank: 'втбанк',
  '1c': '1с',
  '1centerprise': '1с предприятие',
  '1с': '1с',
  '1с предприятие': '1с предприятие',
  rostelecom: 'ростелеком',
  mts: 'мтс',
  beeline: 'билайн',
  megafon: 'мегафон',
  tele2: 'теле2',
  wildberries: 'вайлдберриз',
  avito: 'авито',
  x5: 'х5',
  x5tech: 'х5 тех',
  kaspersky: 'касперский',
  rostec: 'ростех',
  russianpost: 'почта россии',
  selectel: 'селектел',
  'reg.ru': 'рег ру',
  csc: 'цск',
  skb: 'скб контур',
  kontur: 'контур',
};

// Переводит одно латинское слово: сначала таблица брендов, потом буквы.
// Порядок обязателен — см. комментарий над вызовом.
function latWord(w) {
  if (!w) return w;
  const lower = w.toLowerCase();
  if (BRAND_ALIAS[lower]) return BRAND_ALIAS[lower];
  if (/^<<\d+>>$/.test(lower)) return lower;
  let o = lower.replace(/(sh|ch|ts|cs|zs|ks|ps|ya|yu|yo|ye|yi|ky|kj|kh|gh|eu|au|ou|q|w)/g,
    (m) => DIGRAPH[m] || m);
  o = o.replace(/y(?![a-z])/g, 'й');
  o = o.replace(/[a-z]/g, (c) => LAT2CYR[c] || c);
  return o;
}

function latToCyr(s) {
  // Токены, которые не переводим: ios, crm, 1c и подобные. Маскируются видимым
  // маркером — NUL-байты в исходнике ломают чтение файла инструментами.
  const keep = [];
  let out = String(s).replace(KEEP_LATIN, (m) => {
    keep.push(m.toLowerCase());
    return '<<' + (keep.length - 1) + '>>';
  });

  out = out.split(' ').map(latWord).join(' ');

  // Многословные ключи: «1centerprise» склеенный без пробелов.
  const flat = out.replace(/[^a-zа-яё0-9]/gi, '');
  if (BRAND_ALIAS[flat]) return BRAND_ALIAS[flat];

  out = out.replace(/<<(\d+)>>/g, (m, n) => keep[Number(n)]);
  return out;
}

function normCompany(name) {
  const L = '(?![а-яёa-z0-9])';
  const B = '(?<![а-яёa-z0-9])';
  const ORG = '(?:ооо|оао|зао|пао|ао|оо|ип|нпо|нпп|гк|гбу|фгбу|фгуп|гпу|нпои|аоо)';
  const FOREIGN = '(?:public|ltd|llc|inc|gmbh|co|kg)';
  const re = new RegExp(B + '(' + ORG + '|' + FOREIGN + ')' + L, 'giu');
  return latToCyr(String(name == null ? '' : name).toLowerCase())
    .replace(/&laquo;|&raquo;/g, ' ')
    .replace(/[«»"'’]/g, ' ')
    .replace(re, ' ')
    .replace(new RegExp('[^' + CYR + 'a-z0-9]+', 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DB_FILE = path.join(__dirname, 'hardsearchwork.db');

/**
 * Ищет компанию перед вставкой: сначала точное совпадение norm, потом близкое по
 * пересечению слов.
 *
 * Зачем близкое. Транслитерация латиницы в кириллицу приблизительна, и это не
 * лечится добавлением очередного диграфа: «Yandex» даёт «яндех», «Kaspersky» —
 * «касперскй», а «Yamal» — «йамал». Одна компания на двух площадках приходит
 * разными написаниями, точное совпадение их не сводит, и появляется вторая
 * строка — то есть вторая рассылка тем же людям.
 *
 * Поэтому мера не «сделать транслитерацию точной» (это бесконечная гонка), а
 * «перед вставкой спросить, не та ли это компания». Порог 0.75 по Жаккару
 * означает: совпало не меньше трёх четвертей слов. Для разных компаний с
 * похожим названием порог не достигается — «Ромашка» и «Ромашек» дают пересечение
 * 0, потому что слова разные.
 */
function hasLatin(s) {
  return /[a-z]/.test(String(s == null ? '' : s));
}

// Похожесть строк по посимвольному расстоянию. Нужна только для пар, где одно
// имя написано латиницей, а другое кириллицей: там различие в одну букву — это
// разная транслитерация одного слова, а не другая компания.
function levenshtein(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[m];
}

function charSim(a, b) {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

function findCompany(db, name) {
  const norm = normCompany(name);
  if (!norm) return null;
  const exact = db.prepare('SELECT * FROM companies WHERE norm = ?').get(norm);
  if (exact) return exact;

  const incomingLatin = hasLatin(name);

  // Разделяем полный набор слов и «значимые» (длиннее двух букв).
  //
  // Зачем оба. Значимые слова решают, подходит ли вообще пословное сравнение:
  // «ооо» уже вырезано, а «ип» и «гк» могли остаться и не должны реша��ть, что это
  // одна компания. Но для подсчёта совпадений нужен ПОЛНЫЙ набор: иначе «Яндекс
  // Go» теряет «го», остаётся с одним словом и попадает в ветку посимвольного
  // сравнения, где «Яндекс» и «Яндекс Go» получают 1.0 и склеиваются. Так и было
  // поймано: четыре подразделения Яндекса стали тремя строками.
  const allWords = norm.split(' ').filter(Boolean);
  const words = allWords.filter((w) => w.length > 2);

  const all = db.prepare('SELECT id, name, norm FROM companies').all();
  let best = null;
  let bestScore = 0;
  for (const c of all) {
    const other = c.norm.split(' ').filter(Boolean);
    let score;
    if (allWords.length >= 2 && words.length >= 2) {
      // Пословное совпадение по полному набору: слова разные — это разные компании.
      const set = new Set(other);
      let hit = 0;
      for (const w of allWords) if (set.has(w)) hit++;
      score = hit / allWords.length;
      if (score < 0.75) continue;
    } else if (allWords.length === 1 && other.length === 1) {
      // Одно слово против одного слова. Сравнивать посимвольно можно ТОЛЬКО когда
      // написания из разных алфавитов: «Яндекс» и «Yandex» — одно, а «Ромашка»
      // и «Ромашек» — две разные компании, и для них посимвольная мера дала бы
      // 0.87 и склеила бы их в одну рассылку. Алфавит здесь и есть защита.
      const sameAlphabet = hasLatin(c.name) === incomingLatin;
      if (sameAlphabet) continue;
      score = charSim(words[0], other[0]);
      if (score < 0.8) continue;
    } else {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Вставляет компанию или возвращает существующую. Источник истины для всего
 * цикла: если здесь создастся дубль, ниже по конвейеру поедут два отклика и две
 * рассылки одной компании.
 */
function upsertCompany(db, name, extra) {
  const found = findCompany(db, name);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (found) {
    const sets = ['last_seen = ?'];
    const args = [now];
    for (const k of ['hh_id', 'hh_url', 'site', 'city', 'size', 'about', 'source']) {
      if (extra && extra[k] && !found[k]) {
        sets.push(k + ' = ?');
        args.push(String(extra[k]));
      }
    }
    args.push(found.id);
    db.prepare('UPDATE companies SET ' + sets.join(', ') + ' WHERE id = ?').run(...args);
    return { id: found.id, created: false, name: found.name };
  }
  const norm = normCompany(name);
  const r = db
    .prepare(
      'INSERT INTO companies (name, norm, hh_id, hh_url, site, city, size, about, first_seen, last_seen, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      String(name),
      norm,
      (extra && extra.hh_id) || null,
      (extra && extra.hh_url) || null,
      (extra && extra.site) || null,
      (extra && extra.city) || null,
      (extra && extra.size) || null,
      (extra && extra.about) || null,
      now,
      now,
      (extra && extra.source) || null
    );
  return { id: Number(r.lastInsertRowid), created: true, name: String(name) };
}

module.exports = { open, normCompany, findCompany, upsertCompany, SCHEMA, DB_FILE };

if (require.main === module) {
  const db = open(DB_FILE);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'ix_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  console.log('база: ' + path.basename(DB_FILE));
  console.log('таблиц: ' + tables.length + ' — ' + tables.join(', '));
  console.log('индексов: ' + idx.length);
  console.log('');
  console.log('проверка norm:');
  for (const n of ['ООО Ромашка', 'Ромашка', 'АО «Ромашка»', 'Ooo Romashka', 'ООО РОМАШКА']) {
    console.log('  ' + JSON.stringify(n).padEnd(22) + '→ ' + JSON.stringify(normCompany(n)));
  }
}
