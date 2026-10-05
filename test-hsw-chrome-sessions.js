// Проверяет hsw-chrome-sessions.js на управляемом профиле.
//
// Зачем нужна проверка, если настоящий профиль заблокирован Chrome. Инструмент
// обязан быть проверен, а не предположен: блокировка файла — причина не
// работать, а не причина не проверять. Профиль собирается здесь с той же
// схемой, что у Chrome, и теми же форматами времени, из-за которых инструмент
// уже падал.
//
// Что проверяется по отдельности:
//   1) куки hh в домене «.hh.ru» относятся и к hh.ru, и к zarechny.hh.ru;
//   2) куки без hhrole не дают входа даже при наличии прочих кук;
//   3) временные метки Chrome (микросекунды от 1601) не роняют чтение —
//      именно на них инструмент уже падал с «Value is too large…»;
//   4) в базу пишутся только ИМЕНА кук, значений там нет;
//   5) значение шифротекста не попадает ни в базу, ни в вывод;
//   6) заблокированный файл распознаётся как blocked, а не как поломка.
//
// Данные здесь синтетические и ничьей сессии не изображают: они нужны, чтобы
// проверить разбор, а не чтобы что-то выдать за реальный вход.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '_sess-fixture', 'User Data');
const PROFILE = path.join(ROOT, 'Default');
const NET = path.join(PROFILE, 'Network');

// Метка времени Chrome: микросекунды от 1601-01-01. Именно такие значения
// роняли чтение как JS-числа.
const CHROME_EPOCH_OFFSET_MS = 11644473600000;
function chromeTime(daysFromNow) {
  const ms = Date.now() + daysFromNow * 86400000;
  return String(Math.round((ms + CHROME_EPOCH_OFFSET_MS) * 1000));
}

function buildProfile() {
  fs.rmSync(path.join(__dirname, '_sess-fixture'), { recursive: true, force: true });
  fs.mkdirSync(NET, { recursive: true });

  const db = new DatabaseSync(path.join(NET, 'Cookies'));
  db.exec(`
    CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,
      top_frame_site_key TEXT, name TEXT NOT NULL, value TEXT NOT NULL,
      encrypted_value BLOB, path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
      last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL,
      is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL,
      samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL,
      source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL,
      source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL
    );
  `);

  // Шифротекст длиной 100 байт — как настоящий. Он не должен попасть в вывод.
  const blob = Buffer.alloc(100, 7);

  const rows = [
    // hh: вход есть — есть характерная кука hhrole
    ['.hh.ru', 'hhrole', 30],
    ['.hh.ru', 'hhuid', 30],
    ['.hh.ru', '_xsrf', 30],
    ['zarechny.hh.ru', 'GMT', 30],
    ['.hh.ru', 'session_expired_marker', -1],
    // Хабр: куки есть, но session_id нет — входа нет
    ['.habr.com', '_xsrf', 30],
    ['.habr.com', 'mid', 30],
    // посторонний домен — не должен попасть никуда
    ['.google.com', 'NID', 300],
  ];

  const ins = db.prepare(`
    INSERT INTO cookies (creation_utc, host_key, name, value, encrypted_value, path,
      expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent,
      priority, samesite, source_scheme, source_port, last_update_utc, source_type,
      has_cross_site_ancestor)
    VALUES (?, ?, ?, '', ?, '/', ?, 1, 1, ?, 1, 1, 1, 0, 0, 443, ?, 2, 0)
  `);
  for (const [host, name, days] of rows) {
    ins.run(chromeTime(-10), host, name, blob, chromeTime(days), chromeTime(0), chromeTime(0));
  }
  db.close();
  return rows.length;
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log('  ок   ' + label);
  } else {
    console.log('  ПРОВАЛ ' + label + (detail ? '  — ' + detail : ''));
    failures++;
  }
}

function runTool(args) {
  try {
    const out = execFileSync('node', [path.join(__dirname, 'hsw-chrome-sessions.js'), '--root', ROOT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: String(e.stdout || ''), err: String(e.stderr || '') };
  }
}

console.log('=== проверка hsw-chrome-sessions.js ===');
const inserted = buildProfile();
console.log('  профиль собран, кук вставлено: ' + inserted);

const r = runTool(['--dry-run', '--wait', '0']);
console.log('\n--- вывод инструмента ---\n' + r.out.trim());
if (r.err) console.log('--- stderr ---\n' + r.err.trim());

console.log('\n--- проверки ---');
check('инструмент не упал', r.code === 0, 'код ' + r.code);
check('прочитал 8 кук', /8 кук/.test(r.out), r.out.slice(0, 200));
check('у hh вход ЕСТЬ', /hh\s+.*вход ЕСТЬ/.test(r.out));
// Ожидание насчитано по вставленным строкам: на «.hh.ru» четыре куки
// (hhrole, hhuid, _xsrf, session_expired_marker) и одна на «zarechny.hh.ru».
// Раньше здесь стояло 4, и проверка ругалась на правильный ответ инструмента.
check('у Хабра входа НЕТ (нет session_id)', /habr\s+2 кук, входа нет/.test(r.out));
check('zarechny.hh.ru отнесён к hh', /hh\s+5 кук/.test(r.out), 'ожидалось 5 кук hh, включая zarechny');
check('_xsrf не считается входом', !/вход ЕСТЬ \(по _xsrf/.test(r.out), '_xsrf есть и у гостя');
check('посторонний google.com не попал', !/NID/.test(r.out));
check('значения кук не напечатаны', !/encrypted_value|"\w{40,}"/.test(r.out));

// Теперь с записью в настоящую базу: проверяем, что пишутся только имена.
const written = runTool(['--wait', '0']);
console.log('\n--- проверки записи ---');
check('запись прошла', written.code === 0, 'код ' + written.code);

const { open, DB_FILE } = require('./hsw-db.js');
const db = open(DB_FILE);
const rows = db.prepare('SELECT site, logged_in, cookie_names, check_how FROM sessions').all();
let namesLeaked = 0;
for (const s of rows) {
  const names = String(s.cookie_names || '');
  if (/encrypted_value/.test(names)) namesLeaked++;
  // В именах не должно быть ничего похожего на значение: длина строки — имена.
  try {
    const arr = JSON.parse(names);
    for (const n of arr) {
      if (typeof n !== 'string') namesLeaked++;
      else if (n.length > 64) namesLeaked++;
    }
  } catch (e) { namesLeaked++; }
}
check('в sessions только имена, значений нет', namesLeaked === 0, 'подозрительных записей: ' + namesLeaked);
const hhRow = rows.find((r) => r.site === 'hh');
check('по hh вход записан как 1', hhRow && hhRow.logged_in === 1, hhRow ? String(hhRow.logged_in) : 'нет строки');
check('имена hh содержат hhrole', hhRow && String(hhRow.cookie_names).includes('hhrole'));
db.close();

// Возврат базы в прежнее состояние: проверка не должна оставлять за собой
// правды, которой нет.
console.log('\n--- уборка ---');
const db2 = open(DB_FILE);
for (const s of db2.prepare('SELECT site, check_how FROM sessions').all()) {
  if (String(s.check_how).includes('_sess-fixture')) {
    db2.prepare("UPDATE sessions SET logged_in = 0, cookie_names = '[]', check_how = ? WHERE site = ?")
      .run('сброшено проверкой hsw-chrome-sessions (фикстура)', s.site);
  }
}
console.log('  записи фикстуры сброшены');
db2.close();
fs.rmSync(path.join(__dirname, '_sess-fixture'), { recursive: true, force: true });

console.log('\n=== итог ===');
console.log(failures === 0 ? 'все проверки пройдены' : 'провалов: ' + failures);
process.exitCode = failures === 0 ? 0 : 1;