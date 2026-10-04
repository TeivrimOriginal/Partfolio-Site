// Как на remote-job.ru откликнуться: нужна ли регистрация.
//
// Зачем проверять до того, как готовить очередь отправки. На Хабре оказалось,
// что гостевая форма есть, но упирается в reCAPTCHA; на hh отклик требует входа.
// Здесь то же самое может оказаться верным, и тогда очередь надо готовить иначе.
//
// Использование: node probe-remote-job-apply.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body }));
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

(async function () {
  const report = JSON.parse(require('fs').readFileSync('remote-job-vacancies.json', 'utf8'));
  const v = report.vacancies[0];
  console.log('пробуем вакансию ' + v.id + ': ' + v.title);
  const r = await get(v.href);
  console.log('HTTP ' + r.status + ', ' + r.body.length + ' Б');

  const html = r.body;
  const buttons = [...html.matchAll(/<(button|a)[^>]*>([\s\S]{0,80}?)<\/\1>/gi)]
    .map((m) => ({ tag: m[1], text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40), attrs: m[0].slice(0, 200) }))
    .filter((x) => /Отклик|ответить|Apply|отправить|Войти|Вход|Регистрац/i.test(x.text))
    .slice(0, 8);
  console.log('кнопки отклика: ' + JSON.stringify(buttons, null, 1));

  const forms = [...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/gi)].map((m) => ({
    action: (m[0].match(/action="([^"]*)"/) || [])[1] || null,
    fields: [...m[1].matchAll(/name="([^"]+)"/g)].map((x) => x[1]).slice(0, 12),
  }));
  console.log('формы на странице: ' + JSON.stringify(forms, null, 1).slice(0, 1200));
  console.log('есть капча: ' + /recaptcha|hcaptcha|captcha/i.test(html));
  console.log('есть поля для файла резюме: ' + /type="file"/i.test(html));
  console.log('есть поле для сообщения: ' + /textarea/i.test(html));
  console.log('есть поле телефона: ' + /(tel|phone)/i.test(html));
})();
