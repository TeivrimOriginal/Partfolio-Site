// Хабр Карьера: поиск по навыкам вместо текстовых запросов.
//
// Зачем. Сборщик использует 24 текстовых запроса и нашёл 4 вакансии, которые уже
// отправлены. В шапке сайта есть ссылки вида /vacancies/skills/linux — значит,
// навыки оглавлены и по ним делается отдельная выдача. Она может показать то, что
// текстовый запрос не находит: заголовок вроде «Стажёр» без слова python.
//
// Использование: node probe-habr-skills.js
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body }));
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stateOf(html) {
  const m = html.match(/<script type="application\/json"[^>]*>([\s\S]{1,3000000}?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

const SKILLS = ['python', 'qa', 'postgresql', 'docker', 'ci', 'linux', 'telegram', 'selenium', 'c-', 'rest-api'];

(async function () {
  const found = new Map();
  for (const skill of SKILLS) {
    const url = 'https://career.habr.com/vacancies/skills/' + encodeURIComponent(skill) + '?type=all';
    const r = await get(url);
    const st = r.status === 200 ? stateOf(r.body) : null;
    const v = st && st.vacancies;
    if (!v || !Array.isArray(v.list)) {
      console.log(skill.padEnd(11) + ': HTTP ' + r.status + ', состояния нет или список не найден (' + r.body.length + ' Б)');
    } else {
      const meta = v.meta || {};
      let added = 0;
      for (const item of v.list) {
        const id = String(item.id);
        if (!found.has(id)) { found.set(id, { id: id, title: item.title, company: item.company && item.company.title, remote: item.remoteWork, level: item.qualification, skills: skill }); added++; }
      }
      console.log(skill.padEnd(11) + ': всего ' + (meta.totalResults || '?') + ', на странице ' + v.list.length + ', новых ' + added);
    }
    await sleep(700);
  }
  console.log('');
  console.log('уникальных вакансий по навыкам: ' + found.size);
  const applied = require('fs').existsSync('habr-applied-ids.txt')
    ? require('fs').readFileSync('habr-applied-ids.txt', 'utf8').split(/[,\s]+/).filter((x) => /^\d+$/.test(x))
    : [];
  const fresh = [...found.values()].filter((x) => applied.indexOf(x.id) < 0);
  console.log('из них без отклика: ' + fresh.length);
  for (const f of fresh.slice(0, 40)) {
    console.log('  ' + f.id + ' | ' + String(f.level || '—') + ' | ' + String(f.title || '').slice(0, 52) + ' | ' + String(f.company || '').slice(0, 24) + (f.remote ? ' | удалённо' : ''));
  }
  require('fs').writeFileSync('habr-skill-search.json', JSON.stringify({ generated: new Date().toISOString().slice(0, 10), items: [...found.values()] }, null, 1), 'utf8');
})();
