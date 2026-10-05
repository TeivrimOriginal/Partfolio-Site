// Сбор данных сессии из его Chrome, без участия человека.
//
// Задача. ТЗ требует брать сессии из ЕГО Chrome, а не из отдельного браузера.
// Инструмент сам находит профили Chrome и Edge, читает куки нужных площадок и
// записывает результат в таблицу sessions. Ничего спрашивать не нужно.
//
// Что хранится. ТОЛЬКО ИМЕНА кук, домен, срок и признак шифрования — по решению,
// принятому ранее в этом проекте: значения сессии в базу не кладутся. Значение
// куки — это пароль в открытом виде, и хранить его рядом с отчётами и письмами
// означало бы оставлять пароль там, где его видно при любом открытии папки.
// Имён достаточно, чтобы понять, есть ли вход и какая площадка его требует.
//
// Почему часть профилей недоступна, и что с этим делать. Chrome держит файл
// Cookies открытым без разделяемого доступа. Измерено на этой машине:
//   * Copy-Item → «файл используется другим процессом»;
//   * fs.openSync в node → EBUSY;
//   * FileStream с FileShare.ReadWrite → та же ошибка;
//   * создание тени тома запрещено политикой (vssadmin: Invalid command), а
//     существующая тень от 05.10 00:57 содержит согласованный снимок — при
//     чтении из неё SQLite ругается «database disk image is malformed».
// При этом профиль, который Chrome сейчас не держит, читается напрямую.
// Поэтому инструмент читает доступные профили сам и по незаблокированным.
//
// Ожидание вместо требования. Если профиль заблокирован, инструмент ждёт его
// (по умолчанию до 60 с) и читает, как только Chrome отпустит файл. Закрывать
// браузер вручную не нужно: достаточно, чтобы он был закрыт в момент ожидания.
//
// Запуск:
//   node hsw-chrome-sessions.js               собрать и записать в sessions
//   node hsw-chrome-sessions.js --wait 180    ждать освобождения до 3 минут
//   node hsw-chrome-sessions.js --dry-run     ничего не записывать
//   node hsw-chrome-sessions.js --profile Default   только этот профиль

const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { open, DB_FILE } = require('./hsw-db.js');

// Площадки, для которых ищем сессию. Ключ — как записывается в sessions.site,
// значения — куски домена для поиска.
const SITES = {
  hh: ['hh.ru', 'zarechny.hh.ru'],
  habr: ['habr.com', 'account.habr.com'],
  habr_career: ['career.habr.com'],
};

// Куки, по которым видно вход.
//
// Только те, которых не бывает у гостя. Причина, измеренная на управляемом
// профиле: сначала в этот список попал `_xsrf`, и инструмент писал «вход ЕСТЕ»
// для анонимного посетителя, потому что _xsrf — это CSRF-токен, который
// площадка выдаёт всем. Такой признак входа бесполезен: он есть всегда.
//
// Имена — публичные константы площадок, ничего секретного в перечне нет.
const LOGIN_MARKERS = {
  hh: ['hhrole', 'hhuid'],
  habr: ['session_id'],
  habr_career: ['session_id'],
};

// Куки, которые НЕ являются признаком входа, но присутствуют часто. Выводятся
// отдельно, чтобы было видно разницу между «гость» и «вход».
const NOT_LOGIN = ['_xsrf', 'GMT', 'device_breakpoint', 'iap.uid', 'check_cookies', 'mid', 'vtypev2', 'remember_token', 'hhtmFrom'];

function parseArgs(argv) {
  const out = { wait: 60, dryRun: false, only: null, root: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wait') out.wait = Number(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--profile') out.only = argv[++i];
    // --root задаёт каталог профилей вручную. Нужен для перенесённых и
    // тестовых профилей: Chrome позволяет указать --user-data-dir где угодно,
    // и инструмент не должен уметь только стандартные пути.
    else if (a === '--root') out.root = argv[++i];
  }
  return out;
}

// Где лежат профили браузеров. Проверяются на наличие, а не берутся из настроек:
// путь к профилю можно переопределить флагом в самом Chrome.
function profileRoots(explicitRoot) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const out = explicitRoot
    ? [{ browser: 'chrome', dir: explicitRoot }]
    : [
      { browser: 'chrome', dir: path.join(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'edge', dir: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'brave', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    ];
  return out.filter((b) => {
    try { return require('fs').existsSync(b.dir); } catch (e) { return false; }
  });
}

// Профили внутри каталога: Default и Profile N. Другие каталоги (Guest Profile,
// кэши, расширения) профилями не считаются.
function profilesOf(browserDir) {
  let names = [];
  try { names = require('fs').readdirSync(browserDir); } catch (e) { return []; }
  return names
    .filter((n) => n === 'Default' || /^Profile \d+$/.test(n))
    .map((n) => {
      const dir = path.join(browserDir, n);
      // Начиная с Chrome 96 куки лежат в Network/Cookies, раньше — в Cookies.
      const modern = path.join(dir, 'Network', 'Cookies');
      const legacy = path.join(dir, 'Cookies');
      return {
        name: n,
        dir,
        cookies: require('fs').existsSync(modern) ? modern : (require('fs').existsSync(legacy) ? legacy : null),
        layout: require('fs').existsSync(modern) ? 'Network' : 'корень',
      };
    })
    .filter((p) => p.cookies);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Читает куки профиля. Различает три исхода, и это важно:
//   ok        — файл прочитан
//   locked    — читает тот, кто его держит (нужно подождать)
//   broken    — файл прочитан, но база повреждена (бывает у старой тени тома)
function readCookies(file) {
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const total = db.prepare('SELECT COUNT(*) c FROM cookies').get().c;
    // Временные метки читаются как ТЕКСТ, а не как число.
    //
    // Chrome хранит время в микросекундах от 1601 года, и creation_utc
    // доходит до 13469971822357762 — это больше Number.MAX_SAFE_INTEGER
    // (9007199254740991). node:sqlite бросает на таком значении
    // «Value is too large to be represented as a JavaScript number», и весь
    // профиль падал целиком. Приведение CAST(... AS TEXT) снимает проблему:
    // нам нужен факт «срок задан» и примерная дата, а не точное число.
    const rows = db.prepare(`
      SELECT host_key, name,
             CAST(expires_utc AS TEXT) AS expires_utc,
             CAST(is_secure AS INTEGER) AS is_secure,
             CAST(is_httponly AS INTEGER) AS is_httponly,
             value,
             encrypted_value
      FROM cookies
    `).all();
    return { ok: true, total, rows };
  } catch (e) {
    const msg = String(e.message || '');
    if (/malformed|not a database|corrupt/i.test(msg)) return { ok: false, why: 'broken', detail: msg };
    // «unable to open database file» — это тоже блокировка, а не поломка.
    // node:sqlite сообщает именно так о файле, который держит другой процесс;
    // проверено на профиле Default, где FileStream с FileShare тоже отказывал.
    // Если это считать просто ошибкой, ожидание не сработает и инструмент
    // объявит профиль сломанным вместо того, чтобы подождать.
    if (/EBUSY|locked|busy|being used|unable to open database file|доступ/i.test(msg)) {
      return { ok: false, why: 'locked', detail: msg };
    }
    return { ok: false, why: 'error', detail: msg };
  } finally {
    if (db) { try { db.close(); } catch (e) { /* уже закрыта */ } }
  }
}

// Раскладывает куки по площадкам и решает, есть ли вход.
function analyse(rows) {
  const perSite = {};
  for (const site of Object.keys(SITES)) {
    const parts = SITES[site];
    const names = [];
    let encrypted = 0;
    let persistent = 0;
    let latest = 0;

    for (const r of rows) {
      const host = String(r.host_key || '').toLowerCase();
      // host_key у Chrome либо «.example.com» (включая поддомены), либо
      // «example.com» (строго). Поэтому «.hh.ru» ловит и hh.ru, и zarechny.hh.ru.
      const hit = parts.some((p) => host === p || host === '.' + p || host.endsWith('.' + p));
      if (!hit) continue;
      names.push(r.name);
      if (r.encrypted_value && r.encrypted_value.length > 0) encrypted++;
      // expires_utc приходит строкой (см. CAST в readCookies), поэтому
      // сравнение — числовое после приведения, а не по неявному правилу строк.
      const exp = Number(r.expires_utc || 0);
      if (exp > 0) persistent++;
      if (exp > latest) latest = exp;
    }

    const uniq = [...new Set(names)];
    const markers = LOGIN_MARKERS[site] || [];
    const found = markers.filter((m) => uniq.includes(m));
    perSite[site] = {
      cookieNames: uniq.sort(),
      encrypted: encrypted,
      persistent: persistent,
      latestExpiry: latest > 0 ? new Date(latest / 1000 - 11644473600000).toISOString().slice(0, 19).replace('T', ' ') : '',
      // Признак входа — наличие характерных кук, а не их количество. Один
      // hhrole без остального означает, что сессия просрочена или сброшена.
      loginMarkers: found,
      loggedIn: found.length > 0,
    };
  }
  return perSite;
}

function humanExpiry(iso) {
  if (!iso) return '';
  return iso;
}

async function main() {
  const args = parseArgs(process.argv);
  const roots = profileRoots(args.root);

  console.log('=== сбор данных сессии из браузера ===');
  if (!roots.length) {
    console.log('  браузеров Chromium не найдено в ' + (process.env.LOCALAPPDATA || '?'));
    return;
  }
  for (const b of roots) console.log('  ' + b.browser + ': ' + b.dir);

  const targets = [];
  for (const b of roots) {
    for (const p of profilesOf(b.dir)) {
      if (args.only && p.name !== args.only) continue;
      targets.push({ browser: b.browser, ...p });
    }
  }
  console.log('  профилей к проверке: ' + targets.length);

  const db = args.dryRun ? null : open(DB_FILE);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let wroteAny = false;

  try {
    for (const t of targets) {
      const label = t.browser + '/' + t.name;
      let res = readCookies(t.cookies);

      // Ожидание блокировки. Chrome держит файл, пока профиль открыт; как
      // только он отпустит, чтение проходит. Это позволяет не требовать от
      // человека ничего: он закрывает окно тогда, когда закрывает.
      if (!res.ok && res.why === 'locked' && args.wait > 0) {
        const deadline = Date.now() + args.wait * 1000;
        let waited = 0;
        while (Date.now() < deadline && waited < args.wait * 1000) {
          await sleep(2000);
          waited += 2000;
          res = readCookies(t.cookies);
          if (res.ok) break;
        }
        console.log('  ' + label + ': ждал ' + (waited / 1000) + ' с, ' +
          (res.ok ? 'прочитан' : 'всё ещё заблокирован (' + res.why + ')'));
      }

      if (!res.ok) {
        const whyRu = res.why === 'locked'
          ? 'файл держит Chrome (прочту, когда отпустит)'
          : 'НЕ ПРОЧИТАН (' + res.why + '): ' + res.detail;
        console.log('  ' + label + ' — ' + whyRu);

        // Причину пишем, а данные НЕ трогаем.
        //
        // Первая версия ставила logged_in=0 и cookie_names='[]', и этим стирала
        // то, что было известно раньше: в базе лежали имена кук hh вместе с
        // hhrole, и после неудачной проверки их не стало. Получалось, что
        // инструмент сам доказывал отсутствие входа, хотя не смог даже
        // посмотреть. Заблокированный профиль — это «не проверено», а не
        // «входа нет», и вкладка «Сессии» обязана это различать.
        if (db && !args.dryRun) {
          for (const site of Object.keys(SITES)) {
            // Причина ДОПИСЫВАЕТСЯ, а не заменяет прежний вывод. Иначе каждый
            // прогон стирал бы результат предыдущей проверки: у hh в check_how
            // лежало «403 на /applicant/resumes», и после блокировки профиля
            // этой важной информации не осталось бы. Что проверено и когда —
            // не теряется, а что не проверено — добавляется.
            db.prepare(`
              UPDATE sessions
              SET checked_at = ?,
                  check_how = CASE
                    WHEN COALESCE(check_how, '') = '' THEN ?
                    WHEN INSTR(check_how, ?) > 0 THEN check_how
                    ELSE check_how || ' | ' || ?
                  END
              WHERE site = ?
            `).run(stamp, label + ': ' + whyRu, label + ': ' + whyRu, label + ': ' + whyRu, site);
            // Строки, которых ещё нет, всё же создаём — но с честной приметой.
            const existed = db.prepare('SELECT site FROM sessions WHERE site = ?').get(site);
            if (!existed) {
              db.prepare(`
                INSERT INTO sessions (site, logged_in, cookie_names, checked_at, check_how, tab_id)
                VALUES (?, 0, '[]', ?, ?, '')
              `).run(site, stamp, label + ': ' + whyRu + ' — данные не проверены');
            }
          }
        }
        continue;
      }

      const perSite = analyse(res.rows);
      console.log('\n  --- ' + label + ' (' + res.total + ' кук, макет ' + t.layout + ') ---');

      for (const [site, info] of Object.entries(perSite)) {
        if (!info.cookieNames.length) {
          console.log('    ' + site.padEnd(13) + ' кук нет');
          continue;
        }
        console.log('    ' + site.padEnd(13) +
          info.cookieNames.length + ' кук, ' +
          (info.loggedIn ? 'вход ЕСТЬ (по ' + info.loginMarkers.join(', ') + ')' : 'входа нет (характерных кук нет)') +
          (info.encrypted ? ', значения зашифрованы (' + info.encrypted + ')' : '') +
          (humanExpiry(info.latestExpiry) ? ', свежая до ' + humanExpiry(info.latestExpiry) : ''));

        if (db && !args.dryRun) {
          db.prepare(`
            INSERT INTO sessions (site, logged_in, cookie_names, checked_at, check_how, tab_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(site) DO UPDATE SET
              logged_in = excluded.logged_in,
              cookie_names = excluded.cookie_names,
              checked_at = excluded.checked_at,
              check_how = excluded.check_how,
              tab_id = excluded.tab_id
          `).run(
            site,
            info.loggedIn ? 1 : 0,
            JSON.stringify(info.cookieNames),
            stamp,
            label + (info.loggedIn ? ' → ' + info.loginMarkers.join(',') + ' (только имена кук)' : ' → характерных кук нет'),
            ''
          );
          wroteAny = true;
        }
      }
    }

    console.log('\n=== итог ===');
    if (args.dryRun) {
      console.log('  --dry-run: в базу ничего не записано');
    } else if (wroteAny) {
      const s = require('./hsw-view.js').summary(db);
      console.log('  записано в sessions. Входов: ' + s.sessionsLoggedIn + ' из ' + s.sessionsChecked);
      console.log('  Открыть окно: run-hsw.cmd → вкладка «Сессии и почты»');
    } else {
      console.log('  ни один профиль не прочитан — записывать нечего');
    }
    console.log('\n  Значения кук не сохраняются: в базу пишутся только имена.');
  } finally {
    if (db) db.close();
  }
}

main().catch((e) => {
  console.error('сбой: ' + e.stack);
  process.exitCode = 1;
});