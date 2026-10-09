// Сборщик вакансий. Только то, что действительно можно получить без обхода защиты:
// публичные страницы hh и Фриланс.тред. Никаких обходов капчи и авторизаций.
//
// Три фильтра из ТЗ зашиты в условие выборки, а не в постобработку:
//   удалённо · без опыта · без высшего образования.
// «Без высшего» определяется по описанию: если там «высшее образование» или
// «высшее профильное» — вакансия не наша. Считать это по заголовку нельзя,
// заголовки врут.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, upsertVacancy, companyKey, now, stats } from './db.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const RETRY = [2500, 6000, 15000];
const PAUSE_MS = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/\s+/g, ' ').trim();

/** Запросы под стек. Приоритет Python — он первый и самый частый. */
const QUERIES = [
  'python разработчик', 'python бэкенд', 'python fastapi', 'python автоматизация',
  'парсер python', 'telegram бот python', 'python api', 'стажер python',
  'junior python', 'тестировщик junior', 'qa junior', 'инженер по тестированию',
  'junior devops', 'аналитик junior', 'инженер данных junior',
  'python без опыта', 'разработчик без опыта', 'стажер разработчик',
];

// Границы слов заданы руками: в JavaScript \b и \w не работают по кириллице.
const DEGREE_PATTERNS = [
  /высш(ее|его|им)\s+образован/iu,
  /высшее\s+профильное/iu,
  /необходимо\s+высшее/iu,
  /высшее\s+техническое\s+образование/iu,
  /бакалавр(ат|риат|атр)/iu,
  /магистр(ат|атр|атура)/iu,
  /образование\s+выше\s+среднего/iu,
];

function requiresDegree(text) {
  return DEGREE_PATTERNS.some((re) => re.test(text));
}

async function fetchText(url, tries = 4) {
  let last = 0;
  for (let a = 0; a <= RETRY.length && a < tries; a++) {
    if (a > 0) await sleep(RETRY[Math.min(a - 1, RETRY.length - 1)]);
    try {
      const r = await fetch(HOSTS[a % HOSTS.length] + url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      last = r.status;
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch { /* сеть, повтор */ }
  }
  throw new Error(`не отдали страницу (${last}) ${url}`);
}

function qaText(html, name) {
  return [...html.matchAll(new RegExp(`data-qa="${name}"[^>]*>([\\s\\S]{0,600}?)</`, 'g'))]
    .map((m) => strip(m[1])).filter(Boolean);
}

function jobPosting(html) {
  for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(b[1]);
      for (const n of (j['@graph'] || [j])) if (n['@type'] === 'JobPosting') return n;
    } catch { /* следующий блок */ }
  }
  return {};
}

function cardsOf(html) {
  const out = [];
  for (const chunk of html.split('data-qa="vacancy-serp__vacancy"').slice(1)) {
    const idm = chunk.match(/vacancy\/(\d+)[?"\/]/);
    if (!idm) continue;
    const body = chunk.slice(0, 6000);
    const ti = body.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,300}?)<\/span><\/span><\/span>/);
    const exp = (body.match(/work-experience-([A-Za-z0-9]+)/) || [])[1] || '';
    const sal = [...body.matchAll(/<data value="(\d+)"[^>]*>/g)].map((m) => Number(m[1]));
    out.push({
      externalId: idm[1],
      title: ti ? strip(ti[1]) : '',
      exp,
      from: sal[0] ?? null,
      to: sal[1] ?? null,
      remote: /work-schedule-remote/i.test(body),
    });
  }
  return out;
}

/**
 * Карточка вакансии целиком. Компания, формат, график, описание — отсюда,
 * а не из строки выдачи: в выдаче компании нет вовсе.
 */
async function fetchVacancy(id) {
  const html = await fetchText(`/vacancy/${id}`);
  const jp = jobPosting(html);
  const bs = jp.baseSalary && jp.baseSalary.value;
  const desc = qaText(html, 'vacancy-description').join(' ');

  return {
    company: (jp.hiringOrganization && jp.hiringOrganization.name) || '',
    city: (jp.jobLocation && jp.jobLocation.address && jp.jobLocation.address.addressLocality) || '',
    currency: bs && bs.currency,
    published: (jp.datePosted || '').slice(0, 10),
    validThrough: (jp.validThrough || '').slice(0, 10),
    salaryFrom: (bs && bs.min) ?? null,
    salaryTo: (bs && bs.max) ?? null,
    schedule: qaText(html, 'work-schedule-by-days-text').join(' | '),
    formats: qaText(html, 'work-formats-text').join(' | '),
    description: desc.slice(0, 6000),
    requirements: desc.slice(0, 6000),
    open: /data-qa="vacancy-response-link-top"/.test(html),
    url: `https://hh.ru/vacancy/${id}`,
  };
}

/**
 * Сбор готового списка Хабра в базу. Фильтры уже применены в collect-habr.mjs
 * при разборе карточек — здесь только запись, с тем же upsert, что и для hh.
 */
export async function ingestHabr(db, list, { verbose = true } = {}) {
  const skip = new Set(
    fs.existsSync(path.join(ROOT, 'hh-applied-ids.txt'))
      ? fs.readFileSync(path.join(ROOT, 'hh-applied-ids.txt'), 'utf8')
        .split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s))
      : [],
  );

  let created = 0;
  let skipped = 0;
  for (const v of list) {
    if (!v.remote || !v.noExperience || !v.noDegree) { skipped++; continue; }
    if (skip.has(v.externalId)) { skipped++; continue; }
    const res = upsertVacancy(db, { ...v, companyKey: companyKey(v.company) });
    if (res.created) created++;
    if (verbose) process.stdout.write(`  + ${v.externalId} ${v.title.slice(0, 46)}\n`);
    await sleep(200);
  }
  return { created, skipped };
}

export async function collectHh(db, { pages = 3, verbose = true } = {}) {
  const seen = new Map();
  let pagesDone = 0;

  for (const q of QUERIES) {
    for (let p = 0; p < pages; p++) {
      const url = `/search/vacancy?area=113&work_format=REMOTE&order_by=publication_time`
        + `&text=${encodeURIComponent(q)}&page=${p}`;
      let html;
      try { html = await fetchText(url); } catch { break; }
      const cards = cardsOf(html);
      if (!cards.length) break;
      pagesDone++;
      for (const c of cards) if (!seen.has(c.externalId)) seen.set(c.externalId, c);
      await sleep(PAUSE_MS);
    }
    if (verbose) process.stdout.write(`  запрос «${q}»: карточек в выдаче ${seen.size}\n`);
  }

  // Уже отправленные и разобранные не пересобираем: повторная отправка — худший баг.
  const skip = new Set(
    fs.existsSync(path.join(ROOT, 'hh-applied-ids.txt'))
      ? fs.readFileSync(path.join(ROOT, 'hh-applied-ids.txt'), 'utf8')
        .split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s))
      : [],
  );

  const byReason = {};
  const created = [];
  let i = 0;
  for (const c of seen.values()) {
    i++;
    if (skip.has(c.externalId)) { byReason['уже отправлено ранее'] = (byReason['уже отправлено ранее'] || 0) + 1; continue; }
    if (c.exp && c.exp !== 'noExperience' && c.exp !== 'between1And3') {
      const k = `опыт в карточке: ${c.exp}`;
      byReason[k] = (byReason[k] || 0) + 1;
      continue;
    }
    if (!c.remote) { byReason['не удалённая'] = (byReason['не удалённая'] || 0) + 1; continue; }

    let v;
    try { v = await fetchVacancy(c.externalId); } catch { byReason['не прочитана'] = (byReason['не прочитана'] || 0) + 1; continue; }
    if (!v.open) { byReason['вакансия закрыта'] = (byReason['вакансия закрыта'] || 0) + 1; continue; }

    const full = `${v.description} ${v.requirements}`;
    const degree = requiresDegree(full);
    if (degree) { byReason['требует высшее'] = (byReason['требует высшее'] || 0) + 1; continue; }

    const res = upsertVacancy(db, {
      source: 'hh',
      externalId: c.externalId,
      url: v.url,
      title: c.title,
      company: v.company,
      companyKey: companyKey(v.company),
      salaryFrom: c.from ?? v.salaryFrom,
      salaryTo: c.to ?? v.salaryTo,
      currency: v.currency || 'RUB',
      remote: true,
      noExperience: c.exp === 'noExperience',
      noDegree: true,
      city: v.city,
      schedule: v.schedule,
      experience: c.exp,
      description: v.description,
      requirements: v.requirements,
      published: v.published,
      validThrough: v.validThrough,
    });
    if (res.created) created.push(res.id);
    if (verbose && i % 25 === 0) process.stdout.write(`  проверено ${i}/${seen.size}\n`);
    await sleep(PAUSE_MS);
  }

  return { cards: seen.size, pages: pagesDone, created: created.length, byReason };
}

async function main() {
  const db = openDb();
  const run = db.prepare('INSERT INTO runs (started) VALUES (?)').run(now());
  const runId = Number(run.lastInsertRowid);

  process.stdout.write('Собираю hh: удалённо + без опыта + без высшего…\n');
  const hh = await collectHh(db);
  process.stdout.write(`\nhh: карточек ${hh.cards}, страниц ${hh.pages}, новых ${hh.created}\n`);
  process.stdout.write('отсеяно: ' + JSON.stringify(hh.byReason) + '\n');

  db.prepare('UPDATE runs SET finished = ?, stats = ? WHERE id = ?')
    .run(now(), JSON.stringify({ hh }), runId);

  const s = stats(db);
  process.stdout.write('\nИтог по базе:\n');
  for (const [k, v] of Object.entries(s)) {
    process.stdout.write(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}\n`);
  }
  process.stdout.write('\nБаза: hsw/hsw.sqlite\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('сбор упал:', e && e.stack); process.exit(1); });
}