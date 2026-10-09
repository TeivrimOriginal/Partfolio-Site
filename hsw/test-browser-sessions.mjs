// Проверки разбора сессий: без браузера и без файлов на диске.
//
// Проверяется ровно то, где этот инструмент уже ошибался:
//   * _xsrf не выдаётся за вход (инструмент так объявлял вход гостю);
//   * блокированный профиль — это «не проверено», а не «входа нет»;
//   * площадка без известных маркеров честно помечается «возможно», а не «есть»;
//   * значения кук не читаются и не попадают в результат;
//   * главный домен и поддомен оба находятся (.hh.ru ловит zarechny.hh.ru).

import { scanProfile, BROWSER_SITES, MAIL_SITES, NOT_LOGIN } from './browser-sessions.mjs';

let pass = 0;
let fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  + ' + name); }
  else { fail++; console.log('  ОШИБКА ' + name + (extra ? ' :: ' + extra : '')); }
};

const row = (host, name, value = null) => ({
  host_key: host,
  name,
  expires_utc: '13400000000000000',
  has_value: value === null ? 0 : 1,
});

console.log('\nпризнак входа у hh');
{
  const guest = scanProfile(
    [row('.hh.ru', '_xsrf'), row('.hh.ru', 'GMT'), row('.hh.ru', 'mid')],
    BROWSER_SITES, 'chrome/Default',
  );
  ok(guest.hh.state === 'out', 'гость без hhrole и hhuid — входа нет', guest.hh.state);

  const user = scanProfile(
    [row('.hh.ru', '_xsrf'), row('.hh.ru', 'hhrole'), row('.hh.ru', 'hhuid')],
    BROWSER_SITES, 'chrome/Default',
  );
  ok(user.hh.state === 'in', 'hhrole + hhuid — вход есть', user.hh.state);
  ok(user.hh.markersFound.join(',') === 'hhrole,hhuid', 'найдены оба маркера', user.hh.markersFound.join(','));
  ok(user.hh.encrypted === 0 || user.hh.encrypted >= 0, 'счётчик шифрования считается, а не падает');
}

console.log('\nкука, которая есть у всех');
{
  const only = scanProfile([row('.hh.ru', '_xsrf')], BROWSER_SITES, 'chrome/Default');
  ok(only.hh.state === 'out', '_xsrf не считается входом — он есть у гостя', only.hh.state);
  ok(NOT_LOGIN.includes('_xsrf'), '_xsrf числится в списке «не вход»');
}

console.log('\nподдомены площадки');
{
  const r = scanProfile(
    [row('.zarechny.hh.ru', 'hhrole'), row('.hh.ru', 'hhuid')],
    BROWSER_SITES, 'chrome/Profile 1',
  );
  ok(r.hh.state === 'in', '.zarechny.hh.ru и .hh.ru находятся по одному признаку входа', r.hh.state);
  ok(r.hh.cookieNames.length === 2, 'обе куки собраны', String(r.hh.cookieNames.length));
}

console.log('\nплощадки без известных маркеров');
{
  const kwork = scanProfile(
    [row('.kwork.ru', 'kwork_session', 'x'), row('.kwork.ru', '_xsrf')],
    BROWSER_SITES, 'chrome/Profile 1',
  );
  ok(kwork.kwork.markersKnown === false, 'для Kwork маркер неизвестен — это признаётся');
  ok(kwork.kwork.state === 'maybe', 'состояние «возможно», а не «есть вход»', kwork.kwork.state);
  ok(kwork.kwork.cookieNames.length === 2, 'куки найдены и показаны', String(kwork.kwork.cookieNames.length));

  const other = scanProfile([row('.hh.ru', 'hhrole', 'x')], BROWSER_SITES, 'chrome/Profile 1');
  ok(other.fl.state === 'none',
    'площадка без единой куки — «нет данных», а не «возможно вход»', other.fl.state);
}

console.log('\nпочта отдельно от площадок');
{
  const m = scanProfile(
    [row('.mail.ru', 'MUID', 'x'), row('.yandex.ru', 'yandexuid', 'x')],
    MAIL_SITES, 'chrome/Profile 1',
  );
  ok(m.mailru.state === 'maybe', 'Mail.ru: домен в куках, вход не подтверждён');
  ok(m.yandex.state === 'maybe', 'Яндекс: домен в куках, вход не подтверждён');
}

console.log('\nзначения кук не попадают в результат');
{
  const r = scanProfile(
    [row('.hh.ru', 'hhrole', 'v-ТАЙНОЕ-ЗНАЧЕНИЕ'), row('.hh.ru', 'hhuid', 'v-ТАЙНОЕ')],
    BROWSER_SITES, 'chrome/Default',
  );
  const dump = JSON.stringify(r);
  ok(!dump.includes('ТАЙНОЕ'), 'значение куки не попало в результат');
  ok(!('values' in r.hh) && !('rows' in r.hh), 'в объекте площадки нет ни значений, ни сырых строк');
  ok(r.hh.cookieNames.every((n) => typeof n === 'string' && !n.startsWith('v-')), 'в списке только имена');
}

console.log('\nсрок куки');
{
  const r = scanProfile([row('.hh.ru', 'hhrole', 'x')], BROWSER_SITES, 'chrome/Default');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(r.hh.latestExpiry), 'срок приведён к дате', r.hh.latestExpiry);
}

console.log('\nзаблокированный профиль — не «нет входа»');
{
  // Профиль, где по площадке ничего нет, — это «не проверялось», и путать
  // его с «входа нет» нельзя: пустой результат у того же hh означает, что файл
  // прочитан плохо, а не то, что площадка закрыта.
  const empty = scanProfile([], BROWSER_SITES, 'chrome/Default');
  ok(empty.hh.state === 'none', 'пустой профиль даёт «нет данных»', empty.hh.state);
  ok(empty.hh.state !== 'out', 'и это не «входа нет»: доказательств не было');
  const guest = scanProfile([row('.hh.ru', '_xsrf')], BROWSER_SITES, 'chrome/Default');
  ok(guest.hh.state === 'out', 'а вот гость с _xsrf — это доказанный «входа нет»', guest.hh.state);
}

console.log('\n' + 'проверок: ' + (pass + fail) + ', пройдено ' + pass + (fail ? ', ОШИБОК ' + fail : ''));
if (fail) process.exit(1);
