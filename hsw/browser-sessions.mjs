// Автоматическая привязка площадок по данным браузера.
//
// Что уже было: hsw-chrome-sessions.js находит профили Chrome/Edge/Brave и
// читает куки. Он писал в таблицу sessions другого файла базы (hardsearchwork.db)
// и запускался вручную. Здесь то же самое, но живёт в пакете hsw/ и кормит
// вкладку «Привязки»: нажмил кнопку — привязки появились сами.
//
// ГРАНИЦА, КОТОРУЮ НЕ ПЕРЕХОДИМ. В базу пишутся только ИМЕНА кук, домен, срок
// и признак шифрования. Значения не читаются и не сохраняются: значение куки
// сессии — это пароль в открытом виде, и база, которая лежит рядом с письмами
// работодателям и отчётами, не должна содержать пароли. Автопривязка отвечает на
// вопрос «где есть вход», а не «вынесу ли токен в файл». Решение зафиксировано
// в HSW-SESSIONS.md, и автопривязка его не обходит.
//
// Что именно считается входом. Для hh, Хабра и Хабр Карьеры маркеры известны и
// проверены на живом профиле: hhrole/hhuid, session_id. Для остальных площадок
// таких маркеров нет — неизвестное имя куки, которого нет у гостя, выдумывать
// нельзя (именно так инструмент однажды объявил вход анонимному посетителю из-за
// _xsrf). Для них показывается «домен в куках есть, признак входа не проверен»:
// это факт, а не догадка.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

/**
 * Площадки: домены и, где известно, куки-признаки входа.
 *
 * markers — только проверенные имена. Их отсутствие в списке означает
 * «признак неизвестен», а не «входа нет».
 */
export const BROWSER_SITES = {
  hh: { domains: ['hh.ru', 'zarechny.hh.ru'], markers: ['hhrole', 'hhuid'], label: 'Хабр Карьера (hh)' },
  habr: { domains: ['habr.com', 'account.habr.com'], markers: ['session_id'], label: 'Хабр' },
  habr_career: { domains: ['career.habr.com'], markers: ['session_id'], label: 'Хабр Карьера' },
  hirify: { domains: ['hirify.ru', 'hireup.ru'], markers: [], label: 'HiRFY' },
  fl: { domains: ['fl.ru'], markers: [], label: 'FL.ru' },
  kwork: { domains: ['kwork.ru'], markers: [], label: 'Kwork' },
  linkedin: { domains: ['linkedin.com'], markers: [], label: 'LinkedIn' },
  telegram: { domains: ['web.telegram.org', 'telegram.org'], markers: [], label: 'Telegram' },
};

/**
 * Почтовые провайдеры. Отдельная группа по одной причине: почта — это канал
 * отправки, а не площадка. Логин и пароль из браузера не вынимаются в любом
 * случае; здесь определяется, в какие ящики пользователь входил, чтобы
 * предложить привязку, а не чтобы унести пароль.
 */
export const MAIL_SITES = {
  mailru: { domains: ['mail.ru'], markers: [], label: 'Mail.ru' },
  yandex: { domains: ['yandex.ru', 'yandex.com'], markers: [], label: 'Яндекс' },
  gmail: { domains: ['gmail.com'], markers: [], label: 'Gmail' },
  outlook: { domains: ['outlook.com', 'hotmail.com', 'live.com'], markers: [], label: 'Outlook' },
};

/** Куки, которые бывают у гостя: их наличие входом не является. */
export const NOT_LOGIN = ['_xsrf', 'GMT', 'device_breakpoint', 'iap.uid', 'check_cookies', 'mid',
  'vtypev2', 'remember_token', 'hhtmFrom', 'uxs_uid', 'hhuid_saved'];

export function profileRoots(explicitRoot = null) {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const out = explicitRoot
    ? [{ browser: 'chrome', dir: explicitRoot }]
    : [
      { browser: 'chrome', dir: path.join(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'edge', dir: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'brave', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    ];
  return out.filter((b) => { try { return fs.existsSync(b.dir); } catch { return false; } });
}

export function profilesOf(browserDir) {
  let names = [];
  try { names = fs.readdirSync(browserDir); } catch { return []; }
  return names
    .filter((n) => n === 'Default' || /^Profile \d+$/.test(n))
    .map((n) => {
      const dir = path.join(browserDir, n);
      const modern = path.join(dir, 'Network', 'Cookies');
      const legacy = path.join(dir, 'Cookies');
      const cookies = fs.existsSync(modern) ? modern : (fs.existsSync(legacy) ? legacy : null);
      return { name: n, cookies };
    })
    .filter((p) => p.cookies);
}

/**
 * Чтение файла кук. Три исхода различаются намеренно:
 *   ok      — прочитан
 *   locked  — держит браузер, прочитаем позже (не «поломка»)
 *   broken  — файл есть, но база повреждена
 * Значения кук не читаются: в запросе стоит только имена.
 */
export function readCookieNames(file) {
  let db = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare(`
      SELECT host_key, name,
             CAST(expires_utc AS TEXT) AS expires_utc,
             CAST(encrypted_value AS INTEGER) AS has_value
      FROM cookies
    `).all();
    return { ok: true, rows };
  } catch (e) {
    const msg = String(e.message || '');
    if (/malformed|not a database|corrupt/i.test(msg)) return { ok: false, why: 'broken', detail: msg };
    if (/EBUSY|locked|busy|being used|unable to open database file/i.test(msg)) {
      return { ok: false, why: 'locked', detail: 'файл держит браузер' };
    }
    return { ok: false, why: 'error', detail: msg };
  } finally {
    if (db) { try { db.close(); } catch { /* уже закрыта */ } }
  }
}

const hits = (host, domains) => domains.some((d) => host === d || host === '.' + d || host.endsWith('.' + d));

/**
 * Скан всех площадок по одному профилю.
 * Счётчик encrypted считается по признаку наличия значения: он показывает,
 * что площадка хранит сессию в шифре — то есть подделать её вручную нельзя,
 * и это стоит видеть.
 */
export function scanProfile(rows, allSites, label) {
  const out = {};
  for (const [key, site] of Object.entries(allSites)) {
    const names = [];
    let encrypted = 0;
    let persistent = 0;
    let latest = 0;
    for (const r of rows) {
      const host = String(r.host_key || '').toLowerCase();
      if (!hits(host, site.domains)) continue;
      names.push(r.name);
      if (r.has_value) encrypted++;
      const exp = Number(r.expires_utc || 0);
      if (exp > 0) persistent++;
      if (exp > latest) latest = exp;
    }
    const uniq = [...new Set(names)].sort();
    const markers = site.markers || [];
    const foundMarkers = markers.filter((m) => uniq.includes(m));
    const guests = uniq.filter((n) => NOT_LOGIN.includes(n));
    const exclusive = uniq.filter((n) => !NOT_LOGIN.includes(n));

    // Пустой результат — это «не проверялось», а не «входа нет».
    //
    // Так уже ломалось в hsw-chrome-sessions.js: у профиля, который Chrome держит
    // открытым, нет ни одной куки площадки, и маркеры не найдены — инструмент
    // рапортовал «входа нет», хотя файл он не прочитал. Отсутствие данных и
    // отсутствие входа — разные вещи, и путать их нельзя.
    let state = 'none';
    if (uniq.length) {
      if (markers.length) {
        state = foundMarkers.length ? 'in' : 'out';
      } else {
        // Признак неизвестен: домен в куках есть, но что именно доказывает вход —
        // мы не знаем. «Возможно» честнее, чем «есть».
        state = exclusive.length ? 'maybe' : 'guest';
      }
    }

    out[key] = {
      key,
      label: site.label,
      domains: site.domains,
      cookieNames: uniq,
      markersKnown: markers.length > 0,
      markersFound: foundMarkers,
      encrypted,
      persistent,
      latestExpiry: latest > 0
        ? new Date(latest / 1000 - 11644473600000).toISOString().slice(0, 10)
        : '',
      guestOnly: guests.length === uniq.length && uniq.length > 0,
      state,
      // Отдельные куки без главного домена (kwork.ru отдельно от .kwork.ru)
      // не теряются: пустой cookieNames означал бы «площадки нет», хотя куки
      // на месте. Поэтому имена собираются и здесь, и при объединении профилей.
      profilesInfo: [{ profile: label, cookies: uniq.length, state }],
    };
  }
  return out;
}

/**
 * Полное сканирование: все браузеры, все профили.
 *
 * Заблокированные профили не считаются «нет входа» — они попадают в blocked,
 * и в интерфейсе это третий статус рядом с «вход есть» и «входа нет».
 */
export function scanBrowser({ root = null } = {}) {
  const roots = profileRoots(root);
  const sites = {};
  const blocked = [];
  const scanned = [];

  for (const b of roots) {
    for (const p of profilesOf(b.dir)) {
      const label = b.browser + '/' + p.name;
      const r = readCookieNames(p.cookies);
      if (!r.ok) {
        blocked.push({ profile: label, why: r.why, detail: r.detail });
        continue;
      }
      scanned.push({ profile: label, cookies: r.rows.length });
      const siteHits = scanProfile(r.rows, BROWSER_SITES, label);
      const mailHits = scanProfile(r.rows, MAIL_SITES, label);
      for (const group of [siteHits, mailHits]) {
        for (const [key, info] of Object.entries(group)) {
          if (!sites[key]) sites[key] = { ...info, profilesInfo: [], browsers: [] };
          sites[key].profilesInfo.push(...info.profilesInfo);
          if (!sites[key].browsers.includes(b.browser)) sites[key].browsers.push(b.browser);
          // Состояния объединяются по худшему известному: если в одном профиле
          // вход есть, площадка считается доступной.
          if (info.state === 'in') sites[key].state = 'in';
          if (info.state === 'out' && sites[key].state === 'none') sites[key].state = 'out';
          if (info.state === 'maybe' && sites[key].state !== 'in') sites[key].state = 'maybe';
          sites[key].cookieNames = [...new Set([...sites[key].cookieNames, ...info.cookieNames])].sort();
          sites[key].encrypted = Math.max(sites[key].encrypted, info.encrypted);
        }
      }
    }
  }

  for (const s of Object.values(sites)) {
    s.found = s.state === 'in' || s.state === 'maybe';
    s.locked = blocked.length > 0 && !s.found;
  }

  return {
    roots: roots.map((r) => r.browser),
    scanned,
    blocked,
    sites,
    checkedAt: new Date().toISOString(),
  };
}
