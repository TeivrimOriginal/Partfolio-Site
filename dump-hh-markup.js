// Разметка вакансии hh для гостя: где лежит опыт, зарплата, описание.
//
// Зачем. Вакансии, найденные через агрегатор, надо перепроверить по данным hh, а
// не по описанию агрегатора. Разница видна на конкретном примере: 137824411 в
// описании remote-job выглядит как обычная junior-вакансия, а на странице hh у
// неё в поле «Опыт работы» стоит «1–3 года». Если брать описание агрегатора,
// такой вакансию в отклик не отсечь.
//
// Использование: node dump-hh-markup.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9', Accept: 'text/html' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const loc = res.headers.location;
        // hh отдаёт 302 на городской поддомен, если попросили не тот хост.
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          resolve(get(new URL(loc, url).href, depth + 1));
          return;
        }
        resolve({ status: res.statusCode, body: body, url: url });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  const id = process.argv[2] || '134829827';
  // Чередуем hh.ru и zarechny.hh.ru: гость с одного хоста быстро упирается в
  // троттлинг, и второй хост снимает вопрос.
  const hosts = ['zarechny.hh.ru', 'hh.ru'];
  let r = { status: 0, body: '' };
  for (let attempt = 0; attempt < 3 && r.body.length < 1000; attempt++) {
    r = await get('https://' + hosts[attempt % hosts.length] + '/vacancy/' + id);
    if (r.body.length < 1000) await sleep(2500);
  }
  console.log('вакансия ' + id + ' → HTTP ' + r.status + ', ' + r.body.length + ' Б, хост ' + String(r.url).slice(0, 40));
  const h = r.body;
  const qas = [...new Set((h.match(/data-qa="([a-z0-9\-_]+)"/gi) || []).map((s) => s.slice(9, -1)))];
  console.log('data-qa на странице (' + qas.length + '): ' + qas.slice(0, 40).join(', '));

  const probes = [
    ['Опыт работы', /Опыт работы:[\s\S]{0,80}/],
    ['data-qa=vacancy-experience', /data-qa="[^"]*experience[^"]*"[\s\S]{0,120}/i],
    ['Занятость', /data-qa="[^"]*employer[^"]*"/i],
    ['вакансия закрыта', /Вакансия закрыта|вакансия больше не актуальна/i],
    ['Формат работы', /Формат работы:[\s\S]{0,60}/],
    ['График', /График:[\s\S]{0,60}/],
  ];
  for (const [name, re] of probes) {
    const m = re.exec(h);
    console.log('  ' + name.padEnd(28) + ': ' + (m ? m[0].replace(/\s+/g, ' ').slice(0, 110) : 'нет'));
  }
  await sleep(700);
  // Название и компания.
  const t = (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  console.log('  h1: ' + t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 110));
  await sleep(700);
})();
