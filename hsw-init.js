// Инициализация HardSearchWork: почты и сессии площадок.
//
// Это первый шаг цикла по ТЗ: «подтягиваешь почты, сессию аккаунтов на всех
// сайтах, когда это всё готово — уведомляешь, данные о сессии и почтах можно
// будет глянуть в отдельной вкладке».
//
// Почему браузер тут не трогается. node не умеет читать куки чужого Chrome:
// сессии площадок живут в его профиле, а доступ к нему есть только у меня через
// инструмент браузера. Поэтому проверка сессий делается мной, результат
// записывается в таблицу sessions функцией `setSession`, а этот скрипт читает
// базу и решает, можно ли начинать цикл. Схема сессии и почт при этом одна и та
// же для обоих — вкладка «Сессии» читает базу, а не лезет в браузер.
//
// Что этот скрипт НЕ делает и почему:
//   * не входит в аккаунты — вход требует ввода человеком, и обход капчи или
//     формы пароля здесь неуместен;
//   * не читает пароли из файлов — в БД лежит ИМЯ переменной окружения, а сам
//     пароль остаётся в окружении, иначе база с контактами работодателей лежала
//     бы рядом с паролями от ящиков;
//   * не пишет «всё готово», если что-то не готово. Отчёт врёт хуже, чем его нет.
//
// Использование: node hsw-init.js
const fs = require('fs');
const path = require('path');
const { open, DB_FILE } = require('./hsw-db.js');

// Почты. Список берётся из mailboxes.csv рядом со скриптом. Формат тот же, что
// у уже существующей рассылки, чтобы не заводить второй формат: name,user,host,
// port,daily_limit,pass_env,display_name.
const MAILBOX_CSV = 'mailboxes.csv';

function readMailboxes(db) {
  const full = path.join(__dirname, MAILBOX_CSV);
  const rows = [];
  if (fs.existsSync(full)) {
    const text = fs.readFileSync(full, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const cells = t.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (cells.length < 4) continue;
      if (/^name$/i.test(cells[0])) continue; // заголовок
      rows.push({
        name: cells[0],
        user: cells[1],
        host: cells[2],
        port: Number(cells[3]) || 25,
        daily_limit: Number(cells[4]) || 20,
        pass_env: cells[5] || '',
        display_name: cells[6] || cells[1],
      });
    }
  }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (const m of rows) {
    // usable = 1 только если переменная окружения с паролем реально задана.
    // Иначе в отчёте «почты готовы», а отправка падает на первом же письме.
    const hasPass = m.pass_env && !!process.env[m.pass_env];
    db.prepare(
      'INSERT INTO mailboxes (name,user,host,port,daily_limit,pass_env,display_name,usable,checked_at) VALUES (?,?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(name) DO UPDATE SET user=excluded.user, host=excluded.host, port=excluded.port, ' +
      'daily_limit=excluded.daily_limit, pass_env=excluded.pass_env, display_name=excluded.display_name, ' +
      'usable=excluded.usable, checked_at=excluded.checked_at'
    ).run(m.name, m.user, m.host, m.port, m.daily_limit, m.pass_env, m.display_name, hasPass ? 1 : 0, now);
  }
  return db.prepare('SELECT * FROM mailboxes ORDER BY name').all();
}

// Запись результата проверки сессии. Вызывается мной после пробы в браузере.
function setSession(site, data) {
  const db = open(DB_FILE);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(
    'INSERT INTO sessions (site, logged_in, account, checked_at, cookie_names, check_how, tab_id) VALUES (?,?,?,?,?,?,?) ' +
    'ON CONFLICT(site) DO UPDATE SET logged_in=excluded.logged_in, account=excluded.account, ' +
    'checked_at=excluded.checked_at, cookie_names=excluded.cookie_names, check_how=excluded.check_how, tab_id=excluded.tab_id'
  ).run(site, data.logged_in ? 1 : 0, data.account || null, now, JSON.stringify(data.cookie_names || []), data.how || null, data.tab_id || null);
  db.close();
  return true;
}

function report() {
  const db = open(DB_FILE);
  const boxes = readMailboxes(db);
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY site').all();

  console.log('ИНИЦИАЛИЗАЦИЯ HardSearchWork');
  console.log('база: ' + path.basename(DB_FILE));
  console.log('');

  console.log('ПОЧТЫ ДЛЯ РАССЫЛКИ');
  if (!boxes.length) {
    console.log('  нет файла ' + MAILBOX_CSV);
    console.log('  есть только mailboxes.csv.example — это шаблон, в нём нет ни одной живой почты');
    console.log('  скопируй его в ' + MAILBOX_CSV + ' и заполни под свои ящики');
  } else {
    for (const m of boxes) {
      const pass = m.pass_env ? (process.env[m.pass_env] ? 'пароль в окружении' : 'ПАРОЛЯ НЕТ: ' + m.pass_env) : 'не указан pass_env';
      console.log('  ' + (m.usable ? 'ок    ' : 'не готово') + '  ' + m.name.padEnd(14) + m.user.padEnd(34) + m.host + ':' + m.port + '  ' + pass);
    }
    const usable = boxes.filter((m) => m.usable).length;
    console.log('  готовых ящиков: ' + usable + ' из ' + boxes.length);
  }

  console.log('');
  console.log('СЕССИИ ПЛОЩАДОК');
  if (!sessions.length) {
    console.log('  ни одной сессии не проверено');
  } else {
    for (const s of sessions) {
      let names = [];
      try { names = JSON.parse(s.cookie_names || '[]'); } catch (e) { names = []; }
      console.log(
        '  ' + (s.logged_in ? 'вход есть' : 'НЕТ ВХОДА') + '  ' + s.site.padEnd(12) +
        (s.account || '(аккаунт не определён)').padEnd(20) +
        'проверено ' + String(s.checked_at).slice(5, 16)
      );
      if (names.length) console.log('             куки: ' + names.join(', '));
      if (s.check_how) console.log('             проба: ' + s.check_how);
    }
  }

  const logged = sessions.filter((s) => s.logged_in);
  const mailUsable = boxes.filter((m) => m.usable).length;

  console.log('');
  console.log('ГОТОВНОСТЬ');
  console.log('  площадок со входом: ' + logged.length + ' из ' + sessions.length + (sessions.length ? '' : ' (не проверялись)'));
  console.log('  готовых почт: ' + mailUsable + ' из ' + boxes.length);
  console.log('');
  if (logged.length && mailUsable) {
    console.log('  МОЖНО начинать цикл: есть вход хотя бы на одной площадке и хотя бы одна готовая почта.');
  } else {
    console.log('  ЦИКЛ НЕ ЗАПУСКАЕМ.');
    if (!logged.length) {
      console.log('    причина: нет ни одного входа. Отклик без сессии физически некуда отправить:');
      console.log('    hh отдаёт 403 на /applicant/resumes гостю, Хабр уводит на форму входа.');
      console.log('    вход требует ввода человеком — это капча и пароль, и обходить их нельзя.');
    }
    if (!mailUsable) {
      console.log('    причина: нет готовых почт. Заполни ' + MAILBOX_CSV + ' и задай переменные окружения с паролями.');
    }
  }
  console.log('');
  console.log('Сбор вакансий из node работает и без входа — он читает открытые страницы.');
  console.log('Вход нужен только для отправки: node hsw-send.js');
  db.close();
  return { boxes: boxes.length, mailUsable, sessions: sessions.length, logged: logged.length };
}

module.exports = { setSession, report };

if (require.main === module) report();
