// Отклик на gorodrabot.ru: нужен ли аккаунт.
//
// Зачем. Из 47 вакансий remote-job.ru сорок ведут откликом на gorodrabot.ru.
// Если отклик там уходит без входа — это сорок откликов, которые можно
// отправить прямо сейчас. Если нужен аккаунт, значит нужен один вход на всю
// очередь, и это уже не «сорок дел», а «создать аккаунт и отправить всё».
//
// Использование: node probe-gorodrabot-apply.js
const https = require('https');
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 4) {
          resolve(get(new URL(loc, url).href, depth + 1));
          return;
        }
        resolve({ status: res.statusCode, body: body, url: url });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', (e) => resolve({ status: 0, body: '', err: e.message }));
  });
}

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ').trim();
}

(async function () {
  const targets = JSON.parse(fs.readFileSync('remote-job-targets.json', 'utf8'));
  const gorod = targets.detail.filter((d) => /gorodrabot/.test(d.host));
  console.log('вакансий, ведущих на gorodrabot: ' + gorod.length);
  if (!gorod.length) return;

  const url = gorod[0].href;
  console.log('пробуем ' + url);
  const r = await get(url);
  console.log('HTTP ' + r.status + ', ' + r.body.length + ' Б, итоговый URL: ' + String(r.url).slice(0, 110));

  const t = text(r.body);
  const hints = [
    [/войти|войти через|авторизац/i, 'просит вход'],
    [/зарегистрир|регистрац/i, 'просит регистрацию'],
    [/откликнуться|подать заявку|ответить на вакансию/i, 'есть кнопка отклика'],
    [/прикрепить резюме|загрузить резюме|file/i, 'есть загрузка резюме'],
    [/сопроводительн|письмо|сообщение/i, 'есть поле письма'],
    [/телефон/i, 'просит телефон'],
    [/recaptcha|captcha/i, 'есть капча'],
  ];
  for (const [re, label] of hints) console.log('  ' + (re.test(t) || re.test(r.body) ? 'да  ' : 'нет ') + label);

  const buttons = [...r.body.matchAll(/<(button|a)[^>]*>([\s\S]{0,100}?)<\/\1>/gi)]
    .map((m) => ({ text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 44), attrs: m[0].replace(/\s+/g, ' ').slice(0, 170) }))
    .filter((x) => /отклик|заявк|ответить|войти|регистр/i.test(x.text))
    .slice(0, 10);
  console.log('кнопки: ' + JSON.stringify(buttons, null, 1));

  const forms = [...r.body.matchAll(/<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/gi)].map((m) => ({
    action: m[1],
    fields: [...m[2].matchAll(/name="([^"]+)"/g)].map((x) => x[1]).slice(0, 10),
  }));
  console.log('формы: ' + JSON.stringify(forms).slice(0, 700));

  console.log('текст вокруг отклика: ');
  const i = t.search(/откликнуться|подать заявку/i);
  console.log('  ' + (i >= 0 ? t.slice(Math.max(0, i - 200), i + 400) : 'не найдено'));
})();
