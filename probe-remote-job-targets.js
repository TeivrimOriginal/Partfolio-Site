// Куда реально ведёт отклик на remote-job.ru.
//
// Зачем. На первой же вакансии выяснилось, что кнопка «Откликнуться на вакансию»
// ведёт на gorodrabot.ru: доска агрегирует вакансии других площадок и отправляет
// туда. Значит, собранные 47 вакансий — это не отклики на remote-job, а адреса на
// других досках, и каждая требует своего входа. Считаем распределение, чтобы
// понимать, куда вообще можно откликнуться.
//
// Использование: node probe-remote-job-targets.js
const https = require('https');
const fs = require('fs');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hostOf(u) {
  try { return new URL(u).host; } catch (e) { return 'не абсолютный URL: ' + String(u).slice(0, 60); }
}

(async function () {
  const report = JSON.parse(fs.readFileSync('remote-job-vacancies.json', 'utf8'));
  const rows = report.vacancies || [];
  const byHost = {};
  const detail = [];
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const v = rows[cursor++];
      const r = await get(v.href);
      const m = /id="response_vacancy_button"[\s\S]{0,300}?href="([^"]+)"/i.exec(r.body);
      const href = m ? m[1] : null;
      const host = href ? hostOf(href) : 'кнопки отклика нет';
      byHost[host] = (byHost[host] || 0) + 1;
      detail.push({ id: v.id, title: v.title.slice(0, 50), host: host, href: href });
      await sleep(500);
    }
  }
  await Promise.all([worker(), worker()]);

  console.log('вакансий: ' + rows.length);
  console.log('распределение по площадкам:');
  const sorted = Object.keys(byHost).map((k) => ({ host: k, n: byHost[k] })).sort((a, b) => b.n - a.n);
  for (const s of sorted) console.log('  ' + String(s.n).padStart(3) + '  ' + s.host);
  console.log('');
  console.log('по вакансиям:');
  for (const d of detail) console.log('  ' + d.id + '  ' + d.host.padEnd(26) + ' ' + d.title);

  fs.writeFileSync('remote-job-targets.json', JSON.stringify({ generated: new Date().toISOString().slice(0, 10), byHost: byHost, detail: detail }, null, 1), 'utf8');
  console.log('');
  console.log('отчёт: remote-job-targets.json');
})();
