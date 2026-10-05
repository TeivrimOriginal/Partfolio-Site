// Проверяет, что PDF соответствует текущему HTML.
//
// Зачем. Правка в HTML не доезжает до PDF: PDF печатается из браузера отдельной
// командой, и после удаления «с 2022» из HTML десять PDF остались со старым
// текстом. К отклику прикрепляется именно PDF, поэтому устаревший PDF — это
// та же выдумка, только на один шаг позаже.
//
// Почему по хешу потоков, а не по тексту. Первая версия проверки пыталась
// извлечь текст из PDF и искала в нём «2022». Это не работает: Chrome печатает
// подмножествами шрифтов, в которых кириллица лежит по кодам глифов, а
// `/ToUnicode` в файле нет вообще — распаковка даёт 248 КБ служебных данных и
// ноль читаемых слов. Ложное «всё чисто» хуже отсутствия проверки.
//
// Вместо этого PDF пересобирается из HTML в той же сборке Chrome, с которой он
// делался, и сравнивается SHA-256 распакованных потоков содержимого. Проверено
// на трёх прогонах подряд: хеш совпадает до бита, то есть и PDF детерминирован,
// и сравнение по потокам корректно. Расхождение означает ровно одно: PDF
// собран из другой версии HTML.
//
// Офлайн, кроме локального Chrome.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// SHA-256 по распакованным потокам содержимого. Сырые байты PDF сравнивать
// бесполезно: в них есть дата создания и идентификатор документа, они меняются
// при каждом прогоне.
function contentHash(file) {
  const buf = fs.readFileSync(file);
  const parts = [];
  let i = 0;
  while (true) {
    const s = buf.indexOf('stream', i);
    if (s < 0) break;
    let b = s + 6;
    if (buf[b] === 0x0d) b++;
    if (buf[b] === 0x0a) b++;
    const e = buf.indexOf('endstream', b);
    if (e < 0) break;
    try {
      parts.push(zlib.inflateSync(buf.slice(b, e)));
    } catch (err) {
      // Не текстовый поток (шрифт, картинка) — на содержимое страницы не влияет.
    }
    i = e + 9;
  }
  return crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

function pageCount(file) {
  const buf = fs.readFileSync(file);
  const t = buf.toString('latin1');
  const m = t.match(/\/Count\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

const chrome = findChrome();
if (!chrome) {
  console.log('Chrome не найден — проверка соответствия PDF пропущена.');
  console.log('Искали: ' + CHROME_CANDIDATES.join(', '));
  process.exit(0);
}

const tmp = path.join(os.tmpdir(), 'resume-pdf-verify-' + process.pid);
const profile = path.join(tmp, 'profile');
fs.mkdirSync(profile, { recursive: true });

const pairs = fs
  .readdirSync(__dirname)
  .filter((f) => /^resume.*\.html$/i.test(f))
  .map((f) => f.replace(/\.html$/i, '.pdf'))
  .filter((pdf) => fs.existsSync(path.join(__dirname, pdf)))
  .sort();

let bad = 0;
let missing = 0;

console.log('Chrome: ' + chrome);
console.log('пар HTML/PDF: ' + pairs.length + ' (сравнение по SHA-256 распакованных потоков)');
console.log('');

for (const pdf of pairs) {
  const html = pdf.replace(/\.pdf$/i, '.html');
  const fresh = path.join(tmp, pdf);
  const url = 'file:///' + path.join(__dirname, html).replace(/\\/g, '/');
  try {
    execFileSync(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--user-data-dir=' + profile,
        '--print-to-pdf=' + fresh,
        '--no-pdf-header-footer',
        url,
      ],
      { stdio: 'ignore', timeout: 120000 }
    );
  } catch (err) {
    console.log('  ' + pdf + ': Chrome не отработал — ' + (err && err.message ? err.message.slice(0, 80) : 'ошибка'));
    bad++;
    continue;
  }
  const have = path.join(__dirname, pdf);
  const pages = pageCount(have);
  if (pages !== 1) {
    console.log('  ' + pdf + ': страниц ' + pages + ', резюме должно быть на одной странице A4');
    bad++;
  }
  const a = contentHash(have);
  const b = contentHash(fresh);
  if (a !== b) {
    console.log('  ' + pdf + ': УСТАРЕЛ — собран из другой версии ' + html + ' (потоки ' + a.slice(0, 12) + ' ≠ ' + b.slice(0, 12) + ')');
    bad++;
  } else {
    console.log('  ок  ' + pdf.padEnd(24) + ' совпадает с ' + html + ', страниц ' + pages);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
console.log('расхождений: ' + bad + (missing ? ', файлов нет: ' + missing : ''));
if (bad === 0) {
  console.log('ИТОГ: каждый PDF собран из текущего HTML — устаревших копий нет');
  process.exit(0);
}
process.exit(1);