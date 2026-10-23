// Удалённые вакансии для джуна, у которых работодатель в Екатеринбурге.
//
// Чем этот скрипт отличается от collect-remote-junior.js. Тот ищет удалёнку
// по всей России (area=113) и уже отработал её: 127 отправлено, 53 в очереди,
// 74 в отсеве. Здесь другая выборка — area=3 (Свердловская область) при
// work_format=REMOTE, то есть список компаний, которые сидят в Екатеринбурге
// и нанимают удалённо. Для человека, который живёт в Заречном/Екб, это
// отдельный срез: у части локальных вакансий в удалёнке бывают зарплата выше
// и нет привязки к проездной до офиса.
//
// Правила отбора не дублируются, а импортируются из уже проверенных модулей:
// уровень опыта из карточки поиска, заголовок и компания через hh-target.js,
// текст описания через hh-experience.js. Иначе появилась бы вторая копия
// отбора с другими правилами — именно так в прошлый раз в очередь попали
// 24 вакансии с незакрытым пунктом.
const fs = require('fs');
const path = require('path');
const { QUERIES } = require('./hh-search.js');
const { judge } = require('./hh-target.js');
const { reasonIn } = require('./hh-experience.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const BASE = '/search/vacancy?area=3&work_format=REMOTE&order_by=publication_time&text=';
const PAGES = 3;
const PAUSE_MS = 800;
const RETRY = [2500, 6000, 15000];
const OUT = 'ekb-remote-junior.json';
const EXP_OK = ['noExperience', 'between1And3'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function htmlToText(h) {
  let t = String(h);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–');
  return t.replace(/\s+/g, ' ').trim();
}

function descriptionOf(html) {
  const open = html.indexOf('data-qa="vacancy-description"');
  if (open < 0) return '';
  const start = html.indexOf('>', open);
  const close = html.indexOf('data-qa="vacancy-description-next"', start);
  return htmlToText(html.slice(start, close > 0 ? close : Math.min(html.length, start + 60000)));
}

function qa(html, name) {
  return [...html.matchAll(new RegExp(`data-qa="${name}"[^>]*>([\\s\\S]{0,400}?)<`, 'g'))].map(m => htmlToText(m[1]));
}

async function fetchText(url) {
  let last = 0;
  for (let attempt = 0; attempt <= RETRY.length; attempt++) {
    if (attempt > 0) await sleep(RETRY[attempt - 1]);
    const host = HOSTS[attempt % HOSTS.length];
    try {
      const r = await fetch(host + url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      last = r.status;
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch (e) { last = 0; }
  }
  throw new Error('не отдали страницу, последний статус ' + last);
}

function cardsOf(html) {
  const out = [];
  for (const chunk of html.split('data-qa="vacancy-serp__vacancy"').slice(1)) {
    const idm = chunk.match(/vacancy\/(\d+)[?"\/]/);
    if (!idm) continue;
    const body = chunk.slice(0, 6000);
    const titleM = body.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,300}?)<\/span><\/span><\/span>/);
    const coM = body.match(/data-qa="(?:serp-item__vacancy-employer-text|vacancy-serp__vacancy-employer-text|serp-item__vacancy-employer-name)"[^>]*>([\s\S]{0,200}?)</);
    const expM = body.match(/work-experience-([A-Za-z0-9]+)/);
    const sal = [...body.matchAll(/<data value="(\d+)"[^>]*>/g)].map(m => Number(m[1]));
    out.push({
      id: idm[1],
      title: titleM ? htmlToText(titleM[1]) : '',
      co: coM ? htmlToText(coM[1]) : '',
      exp: expM ? expM[1] : '',
      from: sal[0] ?? null,
      to: sal[1] ?? null,
      remote: /vacancy-label-work-schedule-remote|work-schedule-remote/i.test(body),
    });
  }
  return out;
}

function readApplied(file) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return [];
  const raw = fs.readFileSync(full, 'utf8');
  const ids = raw.split(/[,\s]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s));
  if (raw.trim() && ids.length === 0) throw new Error(file + ' не пуст, но ни один id не разобрался');
  return ids;
}

async function main() {
  const applied = readApplied('hh-applied-ids.txt');
  const shortlist = require('./hh-shortlist.js');
  const drop = require('./hh-shortlist-drop.js');
  const known = new Set(shortlist.map(v => v.id).concat(drop.map(d => d.id), applied));
  console.log('исключаем: отправлено ' + applied.length + ', в шорт-листе ' + shortlist.length + ', в отсеве ' + drop.length);

  const seen = new Map();
  let pages = 0;
  for (const q of QUERIES) {
    for (let p = 0; p < PAGES; p++) {
      let html;
      try { html = await fetchText(BASE + encodeURIComponent(q) + '&page=' + p); }
      catch (e) { console.log('  пропущен запрос: ' + e.message); break; }
      const cards = cardsOf(html);
      if (!cards.length) break;
      pages++;
      for (const c of cards) if (!seen.has(c.id)) seen.set(c.id, c);
      await sleep(PAUSE_MS);
    }
  }
  console.log('запросов ' + QUERIES.length + ', страниц ' + pages + ', карточек ' + seen.size);

  const byReason = {};
  const step2 = [];
  for (const v of seen.values()) {
    if (EXP_OK.indexOf(v.exp) < 0) { const k = 'опыт: ' + (v.exp || 'нет'); byReason[k] = (byReason[k] || 0) + 1; continue; }
    if (!v.remote) { byReason['не удалённая'] = (byReason['не удалённая'] || 0) + 1; continue; }
    if (known.has(v.id)) { byReason['уже отправлено или разобрано'] = (byReason['уже отправлено или разобрано'] || 0) + 1; continue; }
    const j = judge({ title: v.title, company: v.co });
    if (!j.ok) { byReason[j.reason] = (byReason[j.reason] || 0) + 1; continue; }
    step2.push(v);
  }
  console.log('после опыта/удалёнки/заголовка: ' + step2.length + ' ' + JSON.stringify(byReason));

  const keep = [], rejected = [], unread = [];
  for (const v of step2) {
    let html;
    try { html = await fetchText('/vacancy/' + v.id); } catch (e) { unread.push(v.id); continue; }
    const desc = descriptionOf(html);
    const open = /data-qa="vacancy-response-link-top"/.test(html);
    if (!open) { rejected.push({ id: v.id, title: v.title, co: v.co, rule: 'вакансия закрыта' }); continue; }
    const why = desc ? reasonIn(desc) : null;
    if (why) { rejected.push({ id: v.id, title: v.title, co: v.co, rule: why.rule, matched: why.matched, context: why.context }); continue; }
    if (!desc) unread.push(v.id);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    let jp = {};
    for (const b of ld) {
      try { const j = JSON.parse(b[1]); for (const n of (j['@graph'] || [j])) if (n['@type'] === 'JobPosting') jp = n; } catch (e) { }
    }
    keep.push({
      id: v.id, title: v.title, company: v.co,
      employer: (jp.hiringOrganization && jp.hiringOrganization.name) || v.co,
      city: (jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.addressLocality) || '',
      from: v.from, to: v.to,
      exp: v.exp,
      posted: (jp.datePosted || '').slice(0, 10),
      valid: (jp.validThrough || '').slice(0, 10),
      schedule: qa(html, 'work-schedule-by-days-text').join(' | '),
      hours: qa(html, 'working-hours-text').join(' | '),
      formats: qa(html, 'work-formats-text').join(' | '),
      descLen: desc.length,
      url: 'https://hh.ru/vacancy/' + v.id,
    });
    console.log('  ' + v.id + ' | ' + (v.co || '?').slice(0, 22) + ' | ' + v.title.slice(0, 44) + ' | ' + v.from + '-' + v.to);
    await sleep(PAUSE_MS);
  }

  const report = {
    generated: new Date().toISOString().slice(0, 10),
    area: '3 (Свердловская область), work_format=REMOTE',
    queries: QUERIES.length, cards: seen.size, byReason,
    keep, rejected, unreadable: unread,
  };
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(report, null, 1) + '\n', 'utf8');
  console.log('\nпрошли всё: ' + keep.length + ', отсеяно по описанию: ' + rejected.length + ', не прочитано: ' + unread.length);
  const byRule = {};
  for (const r of rejected) byRule[r.rule] = (byRule[r.rule] || 0) + 1;
  console.log('причины: ' + JSON.stringify(byRule));
  console.log('отчёт: ' + OUT);
  return unread.length === 0;
}

main().then(ok => process.exit(ok ? 0 : 1)).catch(e => { console.log('сбор упал: ' + (e && e.stack)); process.exit(1); });