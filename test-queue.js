// Проверка очереди: она должна отдавать письмо по id, собирать скрипт,
// считать остаток и не терять уже отправленное. Итоговые файлы проверки не
// трогает — работает на копиях во временной папке.
const fs = require('fs');
const path = require('path');

// Временные файлы — на D:, а не в %TEMP% на C:. Правило диска: на C: за сессию
// суммарно не больше 64 МБ, и тесты не должны туда ничего писать.
const TMP_ROOT = 'D:\\tmp';
if (!fs.existsSync(TMP_ROOT)) fs.mkdirSync(TMP_ROOT, { recursive: true });
const ORIG_CWD = process.cwd();
const tmp = fs.mkdtempSync(path.join(TMP_ROOT, 'hhq-'));
for (const f of ['LETTERS-SHORTLIST.json', 'hh-applied-ids.txt']) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(tmp, f));
}
process.chdir(tmp);

// Модуль читает файлы относительно cwd, поэтому грузим его уже отсюда.
const src = fs.readFileSync(path.join(__dirname, 'hh-queue.js'), 'utf8');
const Module = require('module');
const m = new Module('hh-queue-test');
m._compile(src.replace(/require\('\.\/hh-apply\.js'\)/g, "require('" + path.join(__dirname, 'hh-apply.js').replace(/\\/g, '\\\\') + "')"), 'hh-queue.js');
m.filename = path.join(__dirname, 'hh-queue.js');
m.paths = Module._nodeModulePaths(__dirname);
const q = m.exports;

let bad = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ok       ' : '  ПРОВАЛ   ') + name + (extra ? '  -> ' + extra : ''));
  if (!ok) bad++;
}

const st = q.stats();
check('шорт-лист прочитан', st.total === 20, 'всего ' + st.total);
check('есть остаток', st.left > 0, 'осталось ' + st.left);
check('следующая вакансия известна', !!st.nextId, st.nextId);

const pend = q.pending();
check('очередь не больше шорт-листа', pend.length === st.left);
check('в очереди нет уже отправленных', pend.every((r) => st.sentIds.indexOf(r.id) < 0));

const letter = q.letterFor(st.nextId);
check('письмо не пустое', letter && letter.length > 500, 'символов ' + (letter || '').length);
check('url собран верно', q.urlFor(st.nextId).indexOf('/vacancy/' + st.nextId) > 0);

const script = q.applyScriptFor(st.nextId);
new Function('return ' + script);
check('скрипт собирается в функцию', true);
check('в скрипте есть наш текст письма', script.indexOf(JSON.stringify(letter).slice(1, 40)) > 0);
check('письмо проверяется до отправки', script.indexOf('LETTER_UNVERIFIED') > 0 && script.indexOf('STILL_DISABLED') > 0);
check('капча обнаруживается', /CAPTCHA/.test(script));

// Запись результата: успех должен попасть в список отправленных, капча — нет.
const before = q.stats().sent;
q.record({ id: st.nextId, title: 'тест', company: 'тест', result: 'SENT', letterLen: letter.length });
q.record({ id: '999999999', result: 'CAPTCHA_AFTER_SUBMIT' });
const after = q.stats();
check('после SENT счётчик отправленных вырос', after.sent === before + 1, before + ' -> ' + after.sent);
check('после SENT вакансия ушла из очереди', q.pending().every((r) => r.id !== st.nextId));
check('капча не засчитана как отправка', q.pending().some((r) => r.id === '999999999') === false && after.sent === before + 1);
const sum = q.resultsSummary();
check('журнал попыток записан', sum.attempts === 2, 'попыток ' + sum.attempts);

try { q.letterFor('нет-такой'); check('несуществующий id падает', false); }
catch (e) { check('несуществующий id падает', true); }

console.log('проверок провалено: ' + bad);
process.chdir(ORIG_CWD); // нельзя удалить каталог, в котором стоишь
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
catch (e) { console.log('  ПРЕДУПРЕЖДЕНИЕ: не удалось удалить ' + tmp + ': ' + e.code); }
process.exit(bad === 0 ? 0 : 1);
