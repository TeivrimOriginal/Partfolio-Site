// Перепроверка вакансий hh, найденных через агрегатор, по данным самой hh.
//
// Зачем. Путь «remote-job → gorodrabot → hh» дал 11 номеров hh, которых нет ни в
// шортлисте, ни в отправленных. Но брать их как есть нельзя: описание на
// агрегаторе — это пересказ, и в нём нет структурированных полей hh. Конкретный
// пример: 137824411 в описании remote-job выглядит обычной junior-вакансией, а
// на странице hh у неё «Опыт работы: 1–3 года» и она в архиве с 9 сентября 2026.
// По пересказу такая вакансия ушла бы в отклик.
//
// Правила чтения страницы hh, которые здесь критичны:
//   * «Вакансия закрыта» встречается в HTML даже у живой вакансии — это строки
//     бандла. Искать можно только внутри конкретного data-qa, иначе половина
//     вакансий выглядит закрытой. Проверено на 137824411: строка есть в HTML,
//     вакансия живая.
//   * Признак архива — текст внутри data-qa="vacancy-title", а не отдельная
//     строка «В архиве».
//   * Гость с одного хоста быстро упирается в троттлинг: чередуем hh.ru и
//     zarechny.hh.ru, пауза 700 мс, два потока, повторы.
//
// Использование: node collect-hh-from-aggregator.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const { judge } = require('./hh-target.js');
const { reasonIn, MONTH_THRESHOLD } = require('./hh-experience.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['zarechny.hh.ru', 'hh.ru'];
const PAUSE_MS = 700;
const CONCURRENCY = 2;
const OUT = 'hh-aggregator-vacancies.json';

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&quot;/g, '"'], [/&laquo;/g, '«'], [/&raquo;/g, '»'],
  [/&mdash;/g, '—'], [/&ndash;/g, '–'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&#39;/g, "'"],
  [/&middot;/g, '·'],
];

function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|li|div|h[1-6]|tr|span|td|th)>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

// Текст одного элемента по data-qa. Режет по соответствующему закрывающему тегу
// с учётом вложенности: внутри description есть свои div-ы, и наивный поиск
// первого «</div>» отрезал бы описание до первой строки.
function qa(html, name) {
  const at = html.indexOf('data-qa="' + name + '"');
  if (at < 0) return '';
  const start = html.indexOf('>', at);
  if (start < 0) return '';
  const tagName = (html.slice(at, start).match(/^data-qa="[^"]*"$/i) ? 'div' : (html.slice(at, start).trim().split(/\s+/)[0] || 'div'));
  const tagRe = new RegExp('<' + tagName + '\\b', 'gi');
  const endRe = new RegExp('</' + tagName + '>', 'gi');
  let depth = 1;
  let pos = start + 1;
  let cut = html.length;
  while (pos < html.length) {
    tagRe.lastIndex = pos;
    endRe.lastIndex = pos;
    const o = tagRe.exec(html);
    const c = endRe.exec(html);
    if (!c) break;
    if (o && o.index < c.index) { depth++; pos = o.index + 1; continue; }
    depth--;
    pos = c.index + 1;
    if (depth === 0) { cut = c.index; break; }
  }
  return htmlToText(html.slice(start + 1, cut));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchOnce(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9', Accept: 'text/html' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          resolve(fetchOnce(new URL(loc, url).href, depth + 1));
          return;
        }
        resolve({ status: res.statusCode, body: body });
      });
    });
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

async function fetchVacancy(id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = HOSTS[attempt % HOSTS.length];
    const r = await fetchOnce('https://' + host + '/vacancy/' + id);
    if (r.status === 200 && r.body.length > 20000) {
      return {
        title: qa(r.body, 'vacancy-title'),
        experience: qa(r.body, 'work-experience-text'),
        workFormat: qa(r.body, 'work-formats-text'),
        schedule: qa(r.body, 'work-schedule-by-days-text'),
        company: qa(r.body, 'vacancy-company'),
        salary: qa(r.body, 'vacancy-salary'),
        description: qa(r.body, 'vacancy-description'),
      };
    }
    // Троттлинг: гостая выдача hh обрывается после нескольких десятков запросов,
    // поэтому ждём и берём другой хост.
    await sleep(attempt === 0 ? 2500 : 6000);
  }
  return null;
}

async function main() {
  const resolved = JSON.parse(fs.readFileSync('remote-job-resolved.json', 'utf8'));
  const applied = fs.readFileSync('hh-applied-ids.txt', 'utf8').split(/[,\s]+/).filter((x) => /^\d+$/.test(x));
  const queued = new Set(JSON.parse(fs.readFileSync('LETTERS-SHORTLIST.json', 'utf8')).map((r) => String(r.id)));

  const candidates = resolved.rows.filter((r) => r.hhId && r.state.indexOf('новая') === 0);
  console.log('кандидатов из отчёта разрешения: ' + candidates.length);

  const survivors = [];
  const rejected = [];
  const unreadable = [];
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const c = candidates[cursor++];
      const v = await fetchVacancy(c.hhId);
      await sleep(PAUSE_MS);
      if (!v || !v.title) { unreadable.push(c.hhId + ' (страница не прочитана)'); continue; }
      if (/в архиве/i.test(v.title)) { rejected.push({ id: c.hhId, rule: 'archived', matched: v.title.slice(0, 80) }); continue; }
      if (!/удалённо|удаленно|remote/i.test(v.workFormat)) {
        rejected.push({ id: c.hhId, rule: 'не удалённая', matched: v.workFormat });
        continue;
      }
      const j = judge({ title: v.title, company: v.company });
      if (!j.ok) { rejected.push({ id: c.hhId, rule: j.reason, matched: v.title.slice(0, 80) }); continue; }
      // Опыт берём и из структурированного поля, и из текста: в поле hh пишут
      // «1–3 года», в тексте — «от двух лет коммерческого опыта».
      const why = reasonIn(v.experience + ' ' + v.description, v.experience);
      if (why) { rejected.push({ id: c.hhId, rule: why.rule, matched: why.matched || v.experience }); continue; }
      survivors.push({
        id: c.hhId,
        title: v.title,
        company: v.company,
        salary: v.salary,
        experience: v.experience,
        workFormat: v.workFormat,
        schedule: v.schedule,
        url: 'https://hh.ru/vacancy/' + c.hhId,
        fromRemoteJobId: c.remoteJobId,
        desc: v.description.slice(0, 6000),
        descLen: v.description.length,
      });
    }
  }
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  const report = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'remote-job.ru → gorodrabot.ru → hh.ru',
    thresholdMonths: MONTH_THRESHOLD,
    candidates: candidates.length,
    alreadyApplied: applied.length,
    vacancies: survivors,
    rejected: rejected,
    unreadable: unreadable,
  };
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(report, null, 1) + '\n', 'utf8');

  console.log('прошли: ' + survivors.length);
  for (const s of survivors) {
    console.log('  ' + s.id + ' | ' + s.title.slice(0, 50) + ' | ' + s.company.slice(0, 22) + ' | опыт: ' + (s.experience || 'не указан'));
  }
  const byRule = {};
  for (const r of rejected) byRule[r.rule] = (byRule[r.rule] || 0) + 1;
  console.log('отсеяно: ' + rejected.length + ' ' + JSON.stringify(byRule));
  console.log('не прочитано: ' + unreadable.length + (unreadable.length ? ' → ' + unreadable.join(', ') : ''));
  console.log('отчёт: ' + OUT);
  console.log('в очереди hh уже было: ' + queued.size + ' вакансий');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.log('сбор упал: ' + (e && e.stack)); process.exit(1); });
