// Записывает результат пробы сессий в базу.
//
// Вызывается мной после проверки в браузере: node умеет ходить по открытым
// страницам, но не умеет читать куки чужого Chrome, поэтому проверяю я, а в базу
// пишет этот скрипт. Он же читает JSON на stdin или из файла.
//
// Формат входа — массив объектов:
//   { site, logged_in, account, cookie_names: [...], how: 'чем определяли', tab_id }
//
// Смысл cookie_names: в базу кладются ТОЛЬКО имена кук, без значений. Значение
// куки — это и есть сессия, и хранить его рядом с базой контактов работодателей
// незачем: приложению достаточно знать, что вход есть, а саму отправку делает
// браузер, где сессия уже живёт.
//
// Использование:
//   node hsw-set-sessions.js sessions.json
//   type sessions.json | node hsw-set-sessions.js
const fs = require('fs');
const { setSession, report } = require('./hsw-init.js');

const FILE = process.argv[2];

function read() {
  if (FILE) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const chunks = [];
  try {
    const data = fs.readFileSync(0, 'utf8');
    chunks.push(data);
  } catch (e) {
    // нет stdin — читаем пустой список и скажем об этом
  }
  const text = chunks.join('').trim();
  if (!text) return [];
  return JSON.parse(text);
}

const rows = read();
if (!Array.isArray(rows) || !rows.length) {
  console.log('нечего записывать: нет данных о сессиях');
  console.log('ожидается JSON-массив вида [{"site":"hh","logged_in":false,"how":"проба"}]');
  process.exit(1);
}

for (const r of rows) {
  if (!r || !r.site) {
    console.log('пропущена запись без поля site: ' + JSON.stringify(r));
    continue;
  }
  setSession(r.site, r);
  console.log(
    'записано: ' + r.site.padEnd(12) + (r.logged_in ? 'вход есть' : 'входа нет') +
    (r.account ? '  ' + r.account.slice(0, 40) : '') +
    (r.how ? '  проба: ' + r.how : '')
  );
}
console.log('');
report();
