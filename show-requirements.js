// Печать блока «Требования» и «Обязанности» конкретных вакансий hh.
//
// Зачем. Сборщик hh-candidates.json кладёт в отчёт только id и заголовок
// выживших вакансий, а решение о письме принимается по тексту описания. Без
// печати текста приходилось либо открывать страницу глазами, либо гадать по
// заголовку — а заголовок «Разработчик DWH» ничего не говорит про то, что там
// требуют Airflow и опыт с MSSQL.
//
// Совпадения с «Требования» ищутся по вхождению слова, а не по data-qa: у hh
// разметка блоков меняется, а слово «Требования» есть почти всегда. Печатается
// и «Обязанности», потому что по нему видно, какая работа предлагается.
//
// Использование: node show-requirements.js 138102608 137159215
const https = require('https');

const IDS = process.argv.slice(2);

const ENT = [
  [/&quot;/g, '"'], [/&#39;/g, "'"], [/&laquo;/g, '«'], [/&raquo;/g, '»'],
  [/&mdash;/g, '—'], [/&ndash;/g, '–'], [/&middot;/g, '·'], [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
];

function txt(html) {
  let t = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENT) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const q = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).href, depth + 1));
        return;
      }
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    q.setTimeout(25000, () => { q.destroy(); resolve({ code: 0, body: '' }); });
    q.on('error', () => resolve({ code: 0, body: '' }));
  });
}

// hh троттлит гостя, хосты чередуются — так же, как в collect-remote-junior.js.
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
let turn = 0;

async function getVacancy(id) {
  let last = { code: 0, body: '' };
  for (let i = 0; i < HOSTS.length * 2; i++) {
    last = await get(HOSTS[turn++ % HOSTS.length] + '/vacancy/' + id);
    if (last.code === 200 && last.body.length > 20000 && !/Войти или зарегистрируйтесь/.test(last.body.slice(0, 3000))) return last;
    await new Promise((r) => setTimeout(r, 900));
  }
  return last;
}

// Диапазон описания: от первого из маркеров до условий или следующего блока.
//
// ВАЖНО, про i18n-мусор. На части вакансий в HTML попадает словарь интерфейса
// hh — он начинается с `additionalDataCollector` и идёт до конца страницы
// километром. Из-за этого описание вакансии 137372723 печаталось как 6300
// символов i18n-строк вместо текста вакансии, и разбор вакансии получался
// мусорным. Признак мусора — длинная строка JSON с ключами вида
// `some.key.title` и подсказками. Обрезаем её до первого такого блока.
function cutI18n(t) {
  const i = t.indexOf('additionalDataCollector');
  if (i < 0) return t;
  // Отрезать надо по границе предложения перед мусором, чтобы не срезать
  // последнее слово описания.
  const head = t.slice(0, i);
  const cut = head.lastIndexOf('. ');
  return cut > 0 ? head.slice(0, cut + 1) : head;
}

// Описание: от первого маркера до условий. Источник — блок с классом
// vacancy-description, если он есть: текст между маркерами в верстке hh
// надёжнее не является, потому что «Обязанности» встречается и в i18n.
function descriptionOf(html, t) {
  // 1. Настоящий блок разметки.
  const qa = html.match(/data-qa="vacancy-description"[^>]*>([\s\S]*?)(?:data-qa="|<div class="vacancy-requirements)/);
  if (qa) {
    const d = cutI18n(txt(qa[1]));
    if (d.length > 120) return d;
  }
  // 2. Класс из разметки карточки.
  const byClass = html.match(/class="[^"]*vacancy-description[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  if (byClass) {
    const d = cutI18n(txt(byClass[1]));
    if (d.length > 120) return d;
  }
  // 3. Запасной путь по маркерам в тексте.
  const marks = ['Обязанности', 'Что предстоит', 'Задачи', 'Описание вакансии'];
  let start = -1;
  for (const m of marks) {
    const i = t.indexOf(m);
    if (i >= 0 && (start < 0 || i < start)) start = i;
  }
  if (start < 0) return '';
  const ends = ['Условия', 'Условия работы', 'О вакансии', 'Задайте вопрос', 'Ключевые навыки', 'О компании', 'Dream Job'];
  let end = t.length;
  for (const e of ends) {
    const i = t.indexOf(e, start + 50);
    if (i > 0 && i < end) end = i;
  }
  return cutI18n(t.slice(start, end));
}

(async () => {
  const ids = IDS.length ? IDS : require('./hh-candidates.json').survivors.map((s) => s.id);
  for (const id of ids) {
    const r = await getVacancy(id);
    const t = txt(r.body);
    const title = (r.body.match(/data-qa="vacancy-title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    console.log('');
    console.log('===== ' + id + '  HTTP ' + r.code + '  «' + txt(title) + '»');
    const d = descriptionOf(r.body, t);
    console.log('  длина описания: ' + d.length + ' символов');
    console.log('');
    console.log(d);
    await new Promise((r2) => setTimeout(r2, 1200));
  }
})();