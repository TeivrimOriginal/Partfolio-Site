// Разбор единственного ложного срабатывания нового правила.
//
// Аудит на 53 вакансиях очереди hh дал одно ложное срабатывание:
// 137859546, «• Опыт работы». Смотрю, что там за текст и почему правило его
// отсеяло — если это настоящее требование, то «ложное» ошибочно, и наоборот.
const https = require('https');

const ID = process.argv[2] || '137859546';
const ENT = [[/&quot;/g, '"'], [/&#39;/g, "'"], [/&laquo;/g, '«'], [/&raquo;/g, '»'], [/&mdash;/g, '—'], [/&middot;/g, '·'], [/&nbsp;/g, ' '], [/&amp;/g, '&']];

function txt(h) {
  let t = String(h || '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENT) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const q = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'text/html' } }, (res) => {
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

const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
let turn = 0;

(async () => {
  let r = { code: 0, body: '' };
  for (let i = 0; i < 4; i++) {
    r = await get(HOSTS[turn++ % HOSTS.length] + '/vacancy/' + ID);
    if (r.code === 200 && r.body.length > 20000 && !/Войти или зарегистрируйтесь/.test(r.body.slice(0, 3000))) break;
    await new Promise((x) => setTimeout(x, 900));
  }
  const t = txt(r.body);
  const title = txt((r.body.match(/data-qa="vacancy-title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  console.log('===== ' + ID + '  HTTP ' + r.code + '  «' + title + '»');
  const i = t.indexOf('Опыт работы');
  if (i < 0) { console.log('фразы «Опыт работы» в тексте нет'); return; }
  console.log('');
  console.log(t.slice(Math.max(0, i - 700), i + 700));
})();