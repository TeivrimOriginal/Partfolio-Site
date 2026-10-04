// Проверка резюме перед отправкой отклика.
//
// Зачем это отдельным скриптом. Отклик на Хабре просит ссылку на резюме, и
// ссылка должна быть рабочей и вести на то самое резюме, которое приложено.
// Проверять это приходится каждый раз, а не «на глаз»: до сих пор семь файлов
// под стеки лежали в рабочей папке, но не были отслежены в git, поэтому Pages
// отдавал на них 404 — ссылка была мёртвой, а файл рядом выглядел исправным.
//
// Что проверяется локально:
//   * файл существует и не пустой;
//   * телефон и почта есть, и совпадают с теми, что уже опубликованы в
//     resume.html: подмена контакта в отклике ломает всю воронку;
//   * в тексте нет запрещённых формулировок из требований пользователя;
//   * заголовок страницы совпадает с меткой стека, чтобы ссылка вела на то же
//     самое резюме, а не на соседнее.
//
// Что скрипт НЕ проверяет и почему: доступность ссылки извне. С localhost
// до github.io соединение обрывается (ECONNRESET), поэтому HTTP-проверка отсюда
// всегда будет врать. Живость ссылок проверяется браузером — смётся список в
// выводе, открыть его можно одним проходом.
//
// Использование: node verify-resume-links.js
const fs = require('fs');
const path = require('path');
const { STACKS } = require('./hh-resume-stack.js');

// Формулировки, которые запрещены в резюме по требованию пользователя.
// Совпадение по любой из них — ошибка, а не предупреждение.
const FORBIDDEN = [
  'удалённая работа полностью',
  'готов к стендаму',
  'стажёрская ставка',
  'стажерская ставка',
  'самозанятость',
  'самозанятый',
];

// Эталонный контакт берём из уже опубликованного resume.html, а не пишем руками:
// так проверка ловит расхождение, если в новом файле номер опечатан.
const REF = 'resume.html';
const refText = fs.existsSync(REF) ? fs.readFileSync(REF, 'utf8') : '';
const refPhones = [...new Set((refText.match(/\+7[\s\d\-()]{9,20}/g) || []).map((s) => s.replace(/[\s\-()]/g, '')))];
const refEmails = [...new Set(refText.match(/[\w.\-]+@[\w.\-]+\.\w+/g) || [])];

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
}

let problems = 0;
const rows = [];

for (const stack of Object.keys(STACKS)) {
  const s = STACKS[stack];
  const full = path.join(__dirname, s.file);
  const row = { stack: stack, file: s.file, url: s.publicUrl || null, issues: [] };

  if (!fs.existsSync(full)) {
    row.issues.push('файла нет на диске');
    problems++;
    rows.push(row);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  row.bytes = Buffer.byteLength(text);

  // Контакт. Сравниваем нормализованные номера: в файлах пробелы и дефисы стоят
  // по-разному, но это должен быть один и тот же номер.
  const phones = [...new Set((text.match(/\+7[\s\d\-()]{9,20}/g) || []).map((x) => x.replace(/[\s\-()]/g, '')))];
  const emails = [...new Set(text.match(/[\w.\-]+@[\w.\-]+\.\w+/g) || [])];
  const missingPhone = refPhones.filter((p) => phones.indexOf(p) < 0);
  const missingMail = refEmails.filter((m) => emails.indexOf(m) < 0);
  if (refPhones.length && missingPhone.length) row.issues.push('телефон не совпадает с ' + REF + ': нет ' + missingPhone.join(', '));
  if (refEmails.length && missingMail.length) row.issues.push('почта не совпадает с ' + REF + ': нет ' + missingMail.join(', '));
  row.phone = phones[0] || null;
  row.email = emails[0] || null;

  // Запрещённые формулировки.
  const low = norm(text);
  for (const bad of FORBIDDEN) {
    if (low.indexOf(norm(bad)) >= 0) { row.issues.push('запрещённая формулировка: «' + bad + '»'); problems++; }
  }

  // Заголовок <title> должен называть ту же роль, что и стек, иначе ссылка
  // ведёт на соседнее резюме и работодатель видит не то, что приложено.
  //
  // Сравнение по словам, а не по подстроке: «Junior DevOps-инженер» и
  // «Инженер DevOps» — одно и то же название, просто слова переставлены, и
  // строгий поиск подстроки ругался бы на нормальный файл.
  const title = (text.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  row.title = title.trim().slice(0, 70);
  const titleWords = new Set(norm(title).split(' ').filter(Boolean));
  const namesWords = norm(s.label + ' ' + (s.hhTitle || '')).split(' ').filter(Boolean);
  const missingWords = namesWords.filter((w) => !titleWords.has(w));
  if (title && missingWords.length) {
    row.issues.push('заголовок «' + title.trim() + '» не называет роль: нет слов ' + missingWords.join(', '));
    problems++;
  }

  // Ссылка должна быть на публичную версию того же файла.
  if (s.publicUrl && s.publicUrl.indexOf(s.file) < 0) row.issues.push('publicUrl указывает не на этот файл');

  // Мёртвая ссылка на PDF хуже, чем отсутствие ссылки: это ровно тот случай,
  // когда проверить надо всё, на что кликает человек.
  const pdfLinks = [...new Set((text.match(/href="([^"]*\.pdf)"/g) || []).map((h) => h.slice(6, -1).replace(/^.*\//, '')))];
  for (const p of pdfLinks) {
    if (!fs.existsSync(path.join(__dirname, p))) {
      row.issues.push('ссылка на PDF, которого нет: ' + p);
      problems++;
    }
  }
  row.pdf = pdfLinks.length;

  if (row.issues.length) problems += row.issues.length;
  rows.push(row);
}

// Индекс со списком резюме — это то, куда попадают все ссылки, он тоже должен
// существовать, иначе посетитель сайта не найдёт ни одного резюме.
const INDEX = 'resumes.html';
if (!fs.existsSync(INDEX)) {
  rows.push({ stack: 'index', file: INDEX, url: 'https://teivrimoriginal.github.io/Partfolio-Site/' + INDEX, issues: ['индекс резюме не найден'] });
  problems++;
} else {
  const idx = fs.readFileSync(INDEX, 'utf8');
  const notLinked = Object.keys(STACKS).filter((k) => STACKS[k].publicUrl && idx.indexOf(STACKS[k].file) < 0);
  const missingRefs = [];
  const re = /href="([^"]*resume[^"]*\.html)"/g;
  let m;
  while ((m = re.exec(idx)) !== null) {
    const name = m[1].split('/').pop();
    if (name && !fs.existsSync(path.join(__dirname, name))) missingRefs.push(name);
  }
  const pdfRefs = [...new Set((idx.match(/href="([^"]*\.pdf)"/g) || []).map((h) => h.slice(6, -1).split('/').pop()))];
  for (const p of pdfRefs) {
    if (!fs.existsSync(path.join(__dirname, p))) missingRefs.push(p);
  }
  rows.push({
    stack: 'index',
    file: INDEX,
    url: 'https://teivrimoriginal.github.io/Partfolio-Site/' + INDEX,
    issues: notLinked.length ? ['не ссылается на: ' + notLinked.join(', ')] : (missingRefs.length ? ['ссылается на несуществующие: ' + missingRefs.join(', ')] : []),
  });
  problems += rows[rows.length - 1].issues.length;
}

console.log('стеков: ' + Object.keys(STACKS).length + ', проверяемых файлов: ' + rows.length);
console.log('эталонный контакт из ' + REF + ': ' + (refPhones.join(', ') || 'не найден') + ' · ' + (refEmails.join(', ') || 'не найден'));
console.log('');
for (const r of rows) {
  const mark = r.issues.length ? 'ПРОБЛЕМА' : 'ок';
  console.log('  ' + mark.padEnd(8) + r.stack.padEnd(9) + (r.bytes ? String(r.bytes).padStart(6) + ' Б' : '       ') + '  ' + (r.title || r.file));
  if (r.url) console.log('           ' + r.url);
  for (const i of r.issues) console.log('           ! ' + i);
}
console.log('');
console.log('проблем: ' + problems);
if (problems === 0) {
  console.log('ссылки для проверки в браузере (живость отсюда не проверяется — github.io рвёт соединение):');
  for (const r of rows) if (r.url) console.log('  ' + r.url);
}
process.exit(problems === 0 ? 0 : 1);
