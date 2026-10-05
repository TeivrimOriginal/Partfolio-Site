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
// Живость ссылок проверяется отсюда. Раньше это было невозможно: соединение с
// github.io обрывалось (ECONNRESET) и вывод говорил «проверяйте браузером».
// На 05.10.2026 те же запросы из node проходят, но нестабильно: часть файлов
// вернула пустое тело без кода, и только повтор с паузой дал 200. Отсюда пять
// попыток и 1200 мс между ними — без этого скрипт врал бы в обе стороны: то
// «всё мертво», то «всё живо» на пустых ответах.
//
// Что именно проверяется по сети, помимо кода:
//   * в HTML на сайте нет года 2022 и слова «коммерческий» — локальная проверка
//     следит только за файлами, а читает рекрутер опубликованную копию;
//   * в теле не пусто и есть ожидаемый заголовок.
//
// Использование: node verify-resume-links.js
const fs = require('fs');
const path = require('path');
const https = require('https');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Соединение с github.io отсюда рвётся без кода и без тела. Один ответ ничего
// не значит: считаем успехом только 200 с непустым телом, иначе повторяем.
// Параметры подобраны по факту, а не на глаз. При пяти попытках с паузой 1200 мс
// скрипт объявлял мёртвыми два живых файла: github.io отдаёт серию соединений
// без кода подряд, а потом нормальный ответ. Тот же файл при десяти попытках с
// паузой 2500 мс ответил 200 все десять раз. Отсюда восемь попыток и пауза
// 2500 мс — успех засчитывается только при 200 с непустым телом.
//
// Восьми попыток внутри одного прохода, однако, не хватает: при сплошной
// проверке 15 ссылок девять не ответили, и помог только повторный проход после
// паузы 5000 мс. Проверка поэтому двухпроходная, см. ниже.
const LIVE_ATTEMPTS = 8;
const LIVE_PAUSE_MS = 2500;
const LIVE_BETWEEN_MS = 1500;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function fetchBuf(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 4) {
          resolve(fetchBuf(new URL(res.headers.location, url).href, depth + 1));
          return;
        }
        resolve({ code: res.statusCode, type: res.headers['content-type'] || '', buf: buf });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ code: 0, type: '', buf: Buffer.alloc(0) }); });
    req.on('error', () => resolve({ code: 0, type: '', buf: Buffer.alloc(0) }));
  });
}

async function checkLive(url) {
  let last = { code: 0, type: '', buf: Buffer.alloc(0) };
  for (let i = 0; i < LIVE_ATTEMPTS; i++) {
    last = await fetchBuf(url);
    if (last.code === 200 && last.buf.length > 200) break;
    if (i < LIVE_ATTEMPTS - 1) await sleep(LIVE_PAUSE_MS);
  }
  return last;
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
console.log('локальных проблем: ' + problems);

// Живая проверка опубликованных копий. Локально файл может быть правильным, а
// на сайте лежать старая сборка Pages — так было с семью файлами под стеки, они
// не были в git и Pages отдавал 404.
(async function () {
  const targets = [];
  for (const r of rows) if (r.url) targets.push({ name: r.file, url: r.url });

  // PDF из тех же файлов: к отклику прикрепляется PDF, а не HTML.
  for (const stack of Object.keys(STACKS)) {
    const s = STACKS[stack];
    const full = path.join(__dirname, s.file);
    if (!s.publicUrl || !fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const base = s.publicUrl.replace(/\/[^/]*$/, '/');
    const pdfs = [...new Set((text.match(/href="([^"]*\.pdf)"/g) || []).map((h) => h.slice(6, -1).split('/').pop()))];
    for (const p of pdfs) targets.push({ name: p, url: base + p });
  }

  // Повторов нет: одинаковые ссылки из разных стеков не проверяем дважды.
  const seen = new Set();
  const list = targets.filter((t) => (seen.has(t.url) ? false : (seen.add(t.url), true)));

  console.log('');
  console.log('живая проверка ' + list.length + ' ссылок (до ' + LIVE_ATTEMPTS + ' попыток, пауза ' + LIVE_PAUSE_MS + ' мс):');
  console.log('');

  // Проверка в два прохода, и второй проход — обязательная часть, а не
  // перестраховка.
  //
  // Замерено на 15 ссылках: 9 из 15 не ответили с первого раза, несмотря на
  // восемь попыток с паузой 2500 мс внутри первой проверки. Все девять ответили
  // 200 сразу после паузы 5000 мс. Те же ссылки при отдельном замере с
  // интервалом 2000 мс ответили 10 из 10.
  //
  // То есть дело не в отдельной ссылке, а в том, что подряд идущие запросы
  // к github.io начинают обрываться, и восемь попыток без паузы эту серию не
  // проходят. Повторный проход после длинной паузы отличает «ссылка мертва» от
  // «выдал серию оборванных соединений». Без него проверка объявляет мёртвыми
  // живые файлы, а скрипт, который регулярно врёт, перестают запускать.
  const pass1 = [];
  for (const t of list) {
    const r = await checkLive(t.url);
    const issues = [];
    if (r.code !== 200) issues.push('HTTP ' + (r.code || 'нет ответа'));
    else if (r.buf.length <= 200) issues.push('пустое тело, ' + r.buf.length + ' байт');
    if (!issues.length && /html/.test(r.type)) {
      const txt = r.buf.toString('utf8');
      if (/\b2022\b/.test(txt)) issues.push('на сайте год 2022');
      if (/коммерческ/i.test(txt)) issues.push('на сайте слово «коммерческий»');
      if (!/<title>/i.test(txt)) issues.push('на сайте нет <title>');
    }
    pass1.push({ t: t, r: r, issues: issues });
    await sleep(LIVE_BETWEEN_MS);
  }

  const failed = pass1.filter((p) => p.issues.length && /^HTTP|нет ответа|пустое тело/.test(p.issues[0]));
  if (failed.length) {
    console.log('');
    console.log('не ответили с первого раза: ' + failed.length + ' — повторная проверка через ' + (LIVE_PAUSE_MS * 2) + ' мс');
    for (const p of failed) {
      await sleep(LIVE_PAUSE_MS * 2);
      const r = await checkLive(p.t.url);
      const issues = [];
      if (r.code !== 200) issues.push('HTTP ' + (r.code || 'нет ответа'));
      else if (r.buf.length <= 200) issues.push('пустое тело, ' + r.buf.length + ' байт');
      if (!issues.length && /html/.test(r.type)) {
        const txt = r.buf.toString('utf8');
        if (/\b2022\b/.test(txt)) issues.push('на сайте год 2022');
        if (/коммерческ/i.test(txt)) issues.push('на сайте слово «коммерческий»');
        if (!/<title>/i.test(txt)) issues.push('на сайте нет <title>');
      }
      p.r = r;
      p.issues = issues;
      console.log('  ' + p.t.name + ' → ' + (issues.length ? 'всё ещё плохо' : 'ответил ' + r.code + ', ' + r.buf.length + ' Б'));
    }
  }

  let liveBad = 0;
  for (const { t, r, issues } of pass1) {
    if (issues.length) {
      liveBad++;
      console.log('  ПРОБЛЕМА ' + t.name.padEnd(24) + ' ! ' + issues.join('; '));
      console.log('           ' + t.url);
    } else {
      console.log('  ок       ' + t.name.padEnd(24) + String(r.buf.length).padStart(7) + ' Б  ' + r.type.split(';')[0]);
    }
    await sleep(LIVE_BETWEEN_MS);
  }

  console.log('');
  console.log('живых проблем: ' + liveBad);
  const total = problems + liveBad;
  console.log(total === 0 ? 'ИТОГ: локально чисто и все ссылки на сайте отвечают' : 'ИТОГ: проблем ' + total);
  process.exit(total === 0 ? 0 : 1);
})();
