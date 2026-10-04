// Разведка: отдаёт ли Хабр Карьер данные о вакансиях в HTML без JavaScript.
// Если да — сбор вакансий идёт из node, как на hh, без браузера.
const https = require('https');

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: body, headers: res.headers }));
      }
    );
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
  });
}

(async function () {
  const urls = [
    'https://career.habr.com/vacancies?q=' + encodeURIComponent('python') + '&type=all',
    'https://career.habr.com/vacancies?q=' + encodeURIComponent('стажер') + '&type=all',
  ];
  for (const url of urls) {
    const r = await get(url);
    const b = r.body || '';
    const m = b.match(/<script type="application\/json"[^>]*>([\s\S]{0,400000}?)<\/script>/);
    console.log('--- ' + url);
    console.log('   статус ' + r.status + ', байт ' + b.length);
    if (!m) {
      console.log('   json-состояния в HTML нет');
      console.log('   вакансий в HTML: ' + (b.match(/\/vacancies\/1\d{9}/g) || []).length);
      continue;
    }
    let data = null;
    try { data = JSON.parse(m[1]); } catch (e) { console.log('   json не распарсился: ' + e.message); continue; }
    const v = data.vacancies || {};
    console.log('   JSON: всего ' + (v.meta && v.meta.totalResults) + ', страниц ' + (v.meta && v.meta.totalPages) +
      ', на странице ' + ((v.list || []).length) + ', гость: ' + data.isGuest);
    const first = (v.list || [])[0];
    if (first) {
      console.log('   ключи вакансии: ' + Object.keys(first).join(', '));
      console.log('   пример: ' + JSON.stringify({
        id: first.id, title: first.title, company: first.company_name || first.company,
        remote: first.remote_work, qualification: first.qualification, employment: first.employment,
        skills: first.skills_list || first.skills, salary: first.salary,
      }).slice(0, 400));
    }
  }
})();