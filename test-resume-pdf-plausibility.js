// Проверяет, что PDF не пустой и на одной странице.
//
// Зачем. Хеш потоков в test-resume-pdf-text.js скажет «совпадает с HTML» и для
// файла, в котором отрисовался пустой лист: Chrome сломанный, шрифт не
// загрузился, страница уехала за поля. Тогда PDF формально свежий, а прикреплять
// его нечем. Нужна вторая проверка, независимая от хеша.
//
// Как. Из PDF достаются распакованные потоки и считаются операторы показа
// текста (Tj и TJ). У живого резюме их сотни, у пустого листа — ноль. Порог
// 200 операторов взят с запасом: самый «тихий» файл из одиннадцати даёт больше
// тысячи, а 200 отсекает именно пустые и почти пустые.
//
// Отдельно проверяется `/Count 1`: частая поломка — текст не влез на A4 и
// вторая страница уехала в отдельный файл, который никто не откроет.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MIN_TEXT_OPS = 200;

function analyze(file) {
  const buf = fs.readFileSync(file);
  let i = 0;
  let streamBytes = 0;
  let textOps = 0;
  let fonts = 0;
  while (true) {
    const s = buf.indexOf('stream', i);
    if (s < 0) break;
    let b = s + 6;
    if (buf[b] === 0x0d) b++;
    if (buf[b] === 0x0a) b++;
    const e = buf.indexOf('endstream', b);
    if (e < 0) break;
    try {
      const d = zlib.inflateSync(buf.slice(b, e));
      streamBytes += d.length;
      const latin = d.toString('latin1');
      textOps += (latin.match(/T[jJ]/g) || []).length;
    } catch (err) {
      // Бинарный поток — шрифт или изображение.
    }
    i = e + 9;
  }
  const raw = buf.toString('latin1');
  fonts = (raw.match(/\/Type\s*\/Font/g) || []).length;
  const countMatch = raw.match(/\/Count\s+(\d+)/);
  return { streamBytes, textOps, fonts, pages: countMatch ? Number(countMatch[1]) : 0 };
}

const files = fs.readdirSync(__dirname).filter((f) => /^resume.*\.pdf$/i.test(f)).sort();
let bad = 0;

console.log('pdf для проверки: ' + files.length + ', порог операторов текста: ' + MIN_TEXT_OPS);
console.log('');

for (const f of files) {
  const a = analyze(path.join(__dirname, f));
  const problems = [];
  if (buf_ok(f) === false) problems.push('не PDF');
  if (a.pages !== 1) problems.push('страниц ' + a.pages + ', должно быть 1');
  if (a.textOps < MIN_TEXT_OPS) problems.push('операторов текста ' + a.textOps + ' — лист почти пустой');
  if (a.fonts === 0) problems.push('шрифтов 0 — текст не встроен');
  const line =
    f.padEnd(24) + ' страниц=' + a.pages + '  текст=' + String(a.textOps).padStart(5) +
    '  потоки=' + String(a.streamBytes).padStart(7) + '  шрифтов=' + String(a.fonts).padStart(2) +
    (problems.length ? '  ПРОБЛЕМА: ' + problems.join('; ') : '  ок');
  console.log(line);
  if (problems.length) bad++;
}

function buf_ok(f) {
  return fs.readFileSync(path.join(__dirname, f)).slice(0, 5).toString() === '%PDF-';
}

console.log('');
if (bad === 0) {
  console.log('ИТОГ: все PDF — одна страница, текст есть, шрифты встроены');
  process.exit(0);
}
console.log('ПРОБЛЕМ: ' + bad);
process.exit(1);