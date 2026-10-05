// Печать вакансий, прошедших отбор, целиком.
//
// Зачем. Отчёт collect-remote-junior.js кладёт в hh-candidates.json только
// выжившие: id, заголовок, опыт, длину описания. Компании, зарплаты и текста
// там нет — их видно только на странице. Смотреть три страницы глазами и
// сравнивать с текстом письма медленно и ненадёжно, поэтому печать делается
// здесь.
//
// Заодно печатается признак архива: строка «В архиве» внутри
// data-qa="vacancy-title". Именно он, а не отдельное слово «Вакансия закрыта»
// на странице: вторая строка есть даже у живой вакансии.
//
// Использование: node show-candidates.js
const https = require('https');

const IDS = process.argv.slice(2);

// Редиректы обязательны: hh на прямой запрос /vacancy/<id> отвечает 302, и без
// следования за Location страница приходит пустой. Сборщик с этим справляется
// сам, а вот простой запрос — нет, поэтому здесь глубина до 5 переходов.
function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const q = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 5) {
        res.resume();
        resolve(get(new URL(loc, url).href, depth + 1));
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

// hh троттлит гостя: примерно через десяток запросов подряд страница начинает
// отдавать 403 с карточкой входа вместо вакансии. Хосты чередуются — ровно так
// же, как в collect-remote-junior.js.
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
let turn = 0;

async function getVacancy(id) {
  let last = { code: 0, body: '' };
  for (let i = 0; i < HOSTS.length * 2; i++) {
    const host = HOSTS[turn++ % HOSTS.length];
    last = await get(host + '/vacancy/' + id);
    const ok = last.code === 200 && last.body.length > 20000 && !/Войти или зарегистрируйтесь/.test(last.body.slice(0, 3000));
    if (ok) return last;
    await new Promise((r) => setTimeout(r, 900));
  }
  return last;
}

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

function attr(html, name) {
  const m = html.match(new RegExp('data-qa="' + name + '"[^>]*>([\\s\\S]{0,400}?)<'));
  return m ? txt(m[1]) : '';
}

(async () => {
  const ids = IDS.length ? IDS : require('./hh-candidates.json').survivors.map((s) => s.id);
  for (const id of ids) {
    const r = await getVacancy(id);
    const body = r.body || '';
    const blocked = /Войти или зарегистрируйтесь/.test(body.slice(0, 4000));
    const title = attr(body, 'vacancy-title');
    const company = attr(body, 'vacancy-company-name');
    const salary = attr(body, 'vacancy-salary');
    const exp = attr(body, 'work-experience-text');
    const form = attr(body, 'work-formats-text');
    const archived = /В архиве/.test(title);
    console.log('');
    console.log('=== ' + id + '  HTTP ' + r.code + (blocked ? '  (страница входа — троттлинг)' : ''));
    console.log('  заголовок: ' + title);
    console.log('  компания:  ' + (company || '—'));
    console.log('  зарплата:  ' + (salary || 'не указана'));
    console.log('  опыт:      ' + (exp || '—'));
    console.log('  формат:    ' + (form || '—'));
    console.log('  в архиве:  ' + (archived ? 'ДА — отклик невозможен' : 'нет'));
    // Описание начинается с «О обязанностях» либо с «Описание вакансии».
    const t = txt(body);
    const marks = ['Обязанности', 'Описание вакансии', 'Задачи', 'Что предстоит делать', 'Требования'];
    let start = -1;
    for (const m of marks) {
      const i = t.indexOf(m);
      if (i >= 0 && (start < 0 || i < start)) start = i;
    }
    console.log('  текст:');
    console.log('    ' + t.slice(start >= 0 ? start : 0, (start >= 0 ? start : 0) + 1400));
    await new Promise((r2) => setTimeout(r2, 1200));
  }
})();