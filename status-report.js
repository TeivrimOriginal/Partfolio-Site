// Итог по всем площадкам в одном месте: отправлено, в очереди, отсеяно.
//
// Зачем отдельный скрипт. Цифры разбросаны по файлам, и каждая собиралась вручную
// разными способами. Один из них врал: `require('fs').readFileSync(...).split(/[,\s]+/).filter(x=>/^\d+$/.test(x))`
// внутри `node -e` в PowerShell дал 0 при файле, где 127 id, — оболочка съела
// регулярное выражение. Число «0» было выведено как результат, хотя файл полон.
// Отсюда правило: числа читаются файлом, а не командой в одну строку.
//
// Использование: node status-report.js
const fs = require('fs');
const path = require('path');

const read = (f) => {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/[,\s]+/).filter((x) => /^\d+$/.test(x));
};

function line(label, value, extra) {
  console.log('  ' + label.padEnd(38) + String(value).padStart(6) + (extra ? '  ' + extra : ''));
}

const hhApplied = read('hh-applied-ids.txt');
const habrApplied = read('habr-applied-ids.txt');
const hhQueue = require('./hh-queue.js').pending();
const letters = JSON.parse(fs.readFileSync('LETTERS-SHORTLIST.json', 'utf8'));
const habrLetters = JSON.parse(fs.readFileSync('HABR-LETTERS.json', 'utf8'));
const remoteJob = JSON.parse(fs.readFileSync('REMOTE-JOB-LETTERS.json', 'utf8'));
const drop = require('./hh-shortlist-drop.js');
const shortlist = require('./hh-shortlist.js');

const byStack = {};
for (const r of letters) byStack[r.stack] = (byStack[r.stack] || 0) + 1;

console.log('ОТПРАВЛЕНО');
line('hh', hhApplied.length, hhApplied.length ? 'файл от ' + fs.statSync(path.join(__dirname, 'hh-applied-ids.txt')).mtime.toISOString().slice(0, 10) : '');
line('Хабр Карьера', habrApplied.length);
line('всего', hhApplied.length + habrApplied.length);

console.log('');
console.log('ГОТОВО, НЕ ОТПРАВЛЕНО');
line('hh, письма в очереди', hhQueue.length);
line('из них по стекам', JSON.stringify(byStack));
line('Хабр', habrLetters.length, habrLetters.length ? 'все уже отправлены' : '');
line('remote-job', remoteJob.length, '45 из 47 ведут на другие площадки, на hh они в архиве');

console.log('');
console.log('ОТБОР hh');
line('в отборе', shortlist.length);
line('отсеяно по опыту и прочему', drop.length);
line('осталось в письмах', letters.length);
line('всего отправлено + в очереди', hhApplied.length + letters.length);

console.log('');
console.log('РЕЗЮМЕ НА ПЛОЩАДКЕ, НУЖНЫЕ ДЛЯ ПИСЕМ');
const { STACKS } = require('./hh-resume-stack.js');
for (const k of Object.keys(byStack)) {
  const s = STACKS[k];
  line('«' + s.hhTitle + '»', s.hhResumeReady ? 'есть' : 'НЕТ', byStack[k] + ' вакансий');
}
