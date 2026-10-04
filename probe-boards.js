// Разведка досок вакансий без входа: что отдаёт сервер гостю и есть ли в HTML
// карточки. Зачем: пул hh и Хабр Карьеры исчерпан (127 отправлено + 53 в
// очереди против 4 пригодных на Хабре), а отклик требует либо входа, либо
// прохождения капчи. Сбор вакансий не требует ни того, ни другого, поэтому
// следующий канал ищем здесь.
//
// Использование: node probe-boards.js
const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const BOARDS = [
  { name: 'jobtelegraf', url: 'https://jobtelegraf.com/jobs/python' },
  { name: 'jobtelegraf api', url: 'https://jobtelegraf.com/api/jobs?query=python' },
  { name: 'remote-job', url: 'https://remote-job.ru/search?query=python' },
  { name: 'rabota.yandex', url: 'https://rabota.yandex.ru/search/list?text=python' },
  { name: 'gorodrabot', url: 'https://gorodrabot.ru/?text=python' },
  { name: 'trudvsem', url: 'https://trudvsem.ru/vacancy?query=python' },
  { name: 'zarplata', url: 'https://www.zarplata.ru/vacancy/?query=python' },
  { name: 'career.habr (контроль)', url: 'https://career.habr.com/vacancies?q=python&type=all' },
];

function fetchUrl(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const lib = url.indexOf('http://') === 0 ? http : https;
    const req = lib.get(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/json',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 4) {
          resolve(fetchUrl(new URL(loc, url).href, depth + 1));
          return;
        }
        resolve({ status: res.statusCode, body: body, type: (res.headers['content-type'] || '').slice(0, 40) });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '', type: 'таймаут' }); });
    req.on('error', (e) => resolve({ status: 0, body: '', type: 'ошибка: ' + e.message }));
  });
}

function looksLikeVacancyLinks(body, pat) {
  const m = body.match(pat);
  return { count: m ? m.length : 0, samples: m ? [...new Set(m)].slice(0, 3) : [] };
}

(async function () {
  for (const b of BOARDS) {
    const r = await fetchUrl(b.url);
    const body = r.body || '';
    const isJson = /json/i.test(r.type);
    const out = { board: b.name, status: r.status, type: r.type, bytes: body.length };
    if (r.status === 200 && body) {
      if (isJson) {
        // JSON: ищем что похоже на вакансии и на id.
        let parsed = null;
        try { parsed = JSON.parse(body); } catch (e) { out.jsonError = e.message.slice(0, 60); }
        if (parsed) {
          const arr = Array.isArray(parsed) ? parsed
            : Object.keys(parsed).map((k) => parsed[k]).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object');
          out.topLevel = Array.isArray(parsed) ? 'массив ' + parsed.length : Object.keys(parsed).slice(0, 8).join(',');
          if (arr) {
            out.items = arr.length;
            out.itemKeys = Object.keys(arr[0]).slice(0, 14).join(',');
            const t = arr.slice(0, 3).map((x) => String(x.title || x.name || x.position || JSON.stringify(x).slice(0, 50)));
            out.sampleTitles = t;
          }
        }
      } else {
        out.vacancyLinks = looksLikeVacancyLinks(body, /href="(\/vacanc(?:y|ies)\/[^"#?]{4,40})"/g);
        out.habrLike = looksLikeVacancyLinks(body, /href="(\/vacancies\/\d+)/g);
        out.hasCaptcha = /recaptcha|hcaptcha|captcha/i.test(body);
        out.hasLogin = /Войти|Вход|Login/i.test(body.slice(0, 4000));
        out.jsonScript = looksLikeVacancyLinks(body, /<script type="application\/json"/g).count;
      }
    }
    console.log('--- ' + b.name + ' → HTTP ' + r.status + ', ' + r.type + ', ' + body.length + ' Б');
    for (const k of Object.keys(out)) {
      if (k === 'board' || k === 'status' || k === 'type' || k === 'bytes') continue;
      console.log('    ' + k + ': ' + JSON.stringify(out[k]));
    }
  }
})();
