// Сборщик заказов с Kwork
//
// Kwork — фриланс-биржа, где публикуются проекты (заказы).
// Структура: список проектов на главной странице, каждый проект — карточка с
// заголовком, описанием, бюджетом и ссылкой на детальную страницу.
//
// Использование: node hsw/collect-kwork.mjs

import { openDb, upsertVacancy, companyKey, now } from './db.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://kwork.ru';
const RETRY = [2500, 6000, 12000];
const PAUSE_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const strip = (h) => String(h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  .replace(/\s+/g, ' ').trim();

async function getPage(url) {
  for (let a = 0; a <= RETRY.length; a++) {
    if (a > 0) await sleep(RETRY[a - 1]);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' }
      });
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch { /* сеть */ }
  }
  return '';
}

function extractProjectIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\/projects\/(\d+)/g)) {
    ids.add(m[1]);
  }
  return [...ids];
}

async function fetchProject(id) {
  const html = await getPage(`${BASE}/projects/${id}`);
  if (!html) return null;
  
  const title = strip(html.match(/<h1[^>]*>([^<]+)</)?.[1] || '');
  const desc = strip(html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '');
  const budget = strip(html.match(/<span[^>]*class="[^"]*budget[^"]*"[^>]*>([^<]+)</)?.[1] || '');
  
  return {
    title: title || `Проект ${id}`,
    description: desc,
    budget,
    url: `${BASE}/projects/${id}`,
  };
}

export async function collectKwork({ maxPages = 3, verbose = true } = {}) {
  const db = openDb();
  const seen = new Set();
  let pages = 0;

  for (let p = 1; p <= maxPages; p++) {
    const html = await getPage(`${BASE}/projects?page=${p}`);
    if (!html) break;
    
    const ids = extractProjectIds(html);
    if (!ids.length) break;
    
    pages++;
    for (const id of ids) {
      seen.add(id);
    }
    
    if (verbose) console.log(`  страница ${p}: ${ids.length} проектов, всего ${seen.size}`);
    await sleep(PAUSE_MS);
  }

  const created = [];
  let skipped = 0;
  
  for (const id of seen) {
    const project = await fetchProject(id);
    if (!project) { skipped++; continue; }
    
    const res = upsertVacancy(db, {
      source: 'kwork',
      externalId: id,
      url: project.url,
      title: project.title,
      company: 'Kwork',
      companyKey: 'kwork',
      description: project.description,
      requirements: project.description,
      remote: true,
      noExperience: true,
      noDegree: true,
    });
    
    if (res.created) created.push(res.id);
    if (verbose && created.length % 10 === 0) {
      console.log(`  обработано ${created.length}/${seen.size}`);
    }
    await sleep(PAUSE_MS);
  }

  return { pages, found: seen.size, created: created.length, skipped };
}

if (process.argv[1] && process.argv[1].endsWith('collect-kwork.mjs')) {
  collectKwork({ verbose: true }).then(r => {
    console.log(`\nKwork: страниц ${r.pages}, найдено ${r.found}, создано ${r.created}, пропущено ${r.skipped}`);
  }).catch(e => {
    console.error('Ошибка:', e.message);
    process.exit(1);
  });
}
