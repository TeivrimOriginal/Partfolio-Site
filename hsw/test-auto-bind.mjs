// Проверка автопривязки целиком: синтетический профиль браузера → скан →
// привязка в базе. Сеть не нужна, реальный браузер не трогается.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scanBrowser } from './browser-sessions.mjs';
import { openDb, now } from './db.mjs';

let pass = 0;
let fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  + ' + name); }
  else { fail++; console.log('  ОШИБКА ' + name + (extra ? ' :: ' + extra : '')); }
};

const TMP = path.join(os.tmpdir(), 'hsw-prof-' + process.pid);
const COOKIE_DB = path.join(TMP, 'Default', 'Network', 'Cookies');
const TMP_DB = path.join(os.tmpdir(), 'hsw-accounts-' + process.pid + '.sqlite');

fs.mkdirSync(path.dirname(COOKIE_DB), { recursive: true });
const cd = new DatabaseSync(COOKIE_DB);
cd.exec(`CREATE TABLE cookies (
  host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
  expires_utc INTEGER, creation_utc TEXT, is_secure INTEGER, is_httponly INTEGER)`);
// creation_utc как текст — ровно так его отдаёт реальный Chrome на этой машине.
const ins = cd.prepare('INSERT INTO cookies (host_key,name,value,encrypted_value,expires_utc,creation_utc,is_secure,is_httponly) VALUES (?,?,?,?,?,?,?,?)');
ins.run('.hh.ru', 'hhrole', 'ЗНАЧЕНИЕ-СЕКРЕТ-1', Buffer.from('x'), 13400000000000000, '13400000000000000', 1, 1);
ins.run('.hh.ru', 'hhuid', '12345', Buffer.from('x'), 13400000000000000, '13400000000000000', 1, 1);
ins.run('.hh.ru', '_xsrf', 'csrftoken', Buffer.from('x'), 13400000000000000, '13400000000000000', 1, 1);
ins.run('.kwork.ru', 'kwork_session', 'v', Buffer.from('x'), 13400000000000000, '13400000000000000', 1, 1);
ins.run('.mail.ru', 'MUID', 'v', Buffer.from('x'), 13400000000000000, '13400000000000000', 1, 1);
cd.close();

const scan = scanBrowser({ root: TMP });
ok(scan.scanned.length === 1, 'профиль прочитан', JSON.stringify(scan.scanned));
ok(scan.sites.hh.state === 'in', 'hh: вход доказан маркерами', scan.sites.hh.state);
ok(scan.sites.kwork.state === 'maybe', 'kwork: возможно, признак неизвестен', scan.sites.kwork.state);
ok(scan.sites.mailru.state === 'maybe', 'почта: домен найден, вход не подтверждён', scan.sites.mailru.state);
ok(!JSON.stringify(scan).includes('ЗНАЧЕНИЕ-СЕКРЕТ-1'), 'значение куки не попало в скан');

const db = openDb(TMP_DB);
const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get();
ok(!!table, 'таблица accounts создана миграцией');

const UPSERT = [
  'INSERT INTO accounts (service, login, display, pass_env, daily_limit, enabled, note, created, last_checked, last_ok, last_error)',
  "VALUES (?,?,?,'',20,1,?,?,?,1,'')",
  'ON CONFLICT (service, login) DO UPDATE SET',
  '  last_checked = excluded.last_checked, last_ok = excluded.last_ok,',
  '  last_error = excluded.last_error,',
  "  note = CASE WHEN accounts.note LIKE 'из браузера:%' THEN excluded.note ELSE accounts.note END",
].join(' ');
db.prepare(UPSERT).run(
  'hh', 'hh.ru', 'Хабр Карьера (hh)',
  'из браузера:chrome/Default · куки: hhrole, hhuid',
  new Date().toISOString(),
);
const acc = db.prepare("SELECT * FROM accounts WHERE service='hh'").get();
ok(acc.login === 'hh.ru', 'привязка создана с доменом площадки вместо выдуманного логина', acc.login);
ok(acc.note.startsWith('из браузера:'), 'в заметке виден профиль и имена кук', acc.note);
ok(!JSON.stringify(acc).includes('ЗНАЧЕНИЕ-СЕКРЕТ-1'), 'значение куки в базу не попало');

db.prepare("UPDATE accounts SET note = CASE WHEN note LIKE 'из браузера:%' THEN ? ELSE note END WHERE service = 'hh'")
  .run('из браузера:повторный скан');
const note2 = db.prepare("SELECT note FROM accounts WHERE service='hh'").get().note;
ok(note2.includes('повторный скан'), 'повторный скан обновляет свою же заметку', note2);

db.close();
fs.rmSync(TMP, { recursive: true, force: true });
for (const f of [TMP_DB, TMP_DB + '-wal', TMP_DB + '-shm']) if (fs.existsSync(f)) fs.rmSync(f);

console.log('\nпроверок: ' + (pass + fail) + ', пройдено ' + pass + (fail ? ', ОШИБОК ' + fail : ''));
if (fail) process.exit(1);
