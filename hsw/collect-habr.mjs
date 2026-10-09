// Сбор с Хабр Карьеры.
//
// Площадка отдаёт гостю ровно то, что нужно фильтру: у карточки есть
// remoteWork (формат), employment (занятость), salary (вилка), company и skills.
// Это лучше, чем у hh, где формат приходится вытаскивать из отдельных
// data-qa-элементов карточки.
//
// Данные лежат в <script type="application/json">, а не в HTML: список
// собирается без похода в каждую карточку, то есть в разы быстрее.
// Идентификатор вакансии числовой, версия URL — /vacancies/<id>.

import { writeFileSync as write } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://career.habr.com';
const RETRY = [2500, 6000, 12000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEGREE_RE = /высш(ее|его|им)\s+образован|высшее\s+профильное|необходимо\s+высшее|бакалавр(ат|риат)|магистр(ат|атр)/i;

// Признак уровня «без опыта». Границы заданы руками: \b и \w в JavaScript
// по кириллице не работают, поэтому класс символов явный.
const JUNIOR_RE = /(?:^|[^а-яёa-z])(?:junior|джуниор|middle|программист\s+стаж|стаж[её]р|стажёр|ученик|начальник(?:а|ик)?|trainee|intern)(?:$|[^а-яёa-z])/iu;
// Обратная сторона: старшие уровни отсекаем отдельно, иначе «Senior/Junior
// в одном заголовке» пройдёт как джуновская вакансия.
const SENIOR_RE = /(?:^|[^а-яёa-z])(?:senior|lead|staff|principal|director|head\s+of|руководител|ведущий|главный|эксперт|архитектор|manager)(?:$|[^а-яёa-z])/iu;

const isJuniorLevel = (title, desc) => {
  if (SENIOR_RE.test(title)) return false;
  return JUNIOR_RE.test(title) || /\b(?:без опыта|опыта не требуется|не требуется опыт|опыт не обязателен)\b/iu.test(desc);
};

async function getPage(url) {
  for (let a = 0; a <= RETRY.length; a++) {
    if (a > 0) await sleep(RETRY[a - 1]);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch { /* сеть */ }
  }
  return '';
}

/**
 * Вакансии лежат в vacancies.list, а vacancies — объект {list, meta}.
 *
 * Наблюдение, из-за которого это пришлось выяснять: Object.keys давал
 * «0,1,2…24», и это выглядело как массив, а на деле 25 — это длина list,
 * а не количество ключей. Сборщик молча возвращал ноль вакансий и печатал
 * «страница 1: 2 карточек»: Object.values({list, meta}) даёт два элемента —
 * сам массив и meta.
 */
function vacanciesOf(html) {
  const m = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let j;
  try { j = JSON.parse(m[1]); } catch { return []; }
  const node = j.vacancies;
  if (!node) return [];
  if (Array.isArray(node)) return node;
  if (Array.isArray(node.list)) return node.list;
  // Страховка: если формат снова поменяется, берём любой массив объектов с id.
  const candidates = Object.values(node).filter((v) => Array.isArray(v) && v.some((x) => x && x.id));
  return candidates[0] || [];
}

/** Собирает плоскую строку из всех требований вакансии. */
function requirementsOf(v) {
  const parts = [];
  for (const key of ['skills', 'qualities', 'responsibilities', 'requirements', 'tasks']) {
    const val = v[key];
    if (!Array.isArray(val)) continue;
    for (const item of val) {
      if (typeof item === 'string') parts.push(item);
      else if (item && typeof item === 'object') parts.push(item.title || item.name || '');
    }
  }
  return parts.filter(Boolean).join(' · ');
}

function mapVacancy(v) {
  const desc = [v.description, requirementsOf(v), (v.about || ''), (v.conditions || '')]
    .filter(Boolean).join(' ').slice(0, 6000);
  return {
    source: 'habr',
    externalId: String(v.id),
    url: BASE + (v.href || `/vacancies/${v.id}`),
    title: v.title || '',
    company: (v.company && v.company.title) || '',
    salaryFrom: v.salary && v.salary.from ? v.salary.from : null,
    salaryTo: v.salary && v.salary.to ? v.salary.to : null,
    currency: (v.salary && v.salary.currency) || 'RUB',
    remote: !!v.remoteWork,
    // Метки «без опыта» у Хабра нет вообще: поля experience/experienceLevel
    // в карточке отсутствуют. Первый вариант считал «опыт не указан» как
    // «без опыта» — и тогда 200 из 200 вакансий проходили фильтр, включая
    // Senior/Lead. Теперь признак джуна ищется явно: в заголовке либо в тексте.
    noExperience: isJuniorLevel(v.title || '', desc),
    noDegree: !DEGREE_RE.test(desc),
    city: v.location || (v.location_name || ''),
    schedule: v.employment === 'part_time' ? 'частичная занятость' : 'полная занятость',
    experience: v.experience || '',
    description: desc,
    requirements: requirementsOf(v),
    published: v.publishedDate ? String(v.publishedDate.date).slice(0, 10) : null,
    validThrough: null,
    skills: (v.skills || []).map((s) => (s && s.title) || s).filter(Boolean),
  };
}

/**
 * Обход списка. У Хабра пагинация — параметр page, а не курсор; страницы
 * заканчиваются, когда JSON перестаёт содержать карточки.
 */
export async function collectHabr({ maxPages = 8, verbose = false } = {}) {
  const seen = new Map();
  let pages = 0;

  for (let p = 1; p <= maxPages; p++) {
    const html = await getPage(`${BASE}/vacancies?page=${p}`);
    if (!html) break;
    const list = vacanciesOf(html);
    if (!list.length) break;
    pages++;
    for (const raw of list) {
      const v = mapVacancy(raw);
      if (v.externalId === 'undefined' || !v.title) continue;
      seen.set(v.externalId, v);
    }
    if (verbose) console.log(`  страница ${p}: ${list.length} карточек, всего ${seen.size}`);
    await sleep(1200);
  }

  return { pages, list: [...seen.values()] };
}

// Прямой запуск: node hsw/collect-habr.mjs
if (process.argv[1] && process.argv[1].endsWith('collect-habr.mjs')) {
  const r = await collectHabr({ verbose: true });
  console.log(`\nХабр: страниц ${r.pages}, уникальных вакансий ${r.list.length}`);
  const remote = r.list.filter((v) => v.remote).length;
  const junior = r.list.filter((v) => v.noExperience).length;
  const noDegree = r.list.filter((v) => v.noDegree).length;
  const ok = r.list.filter((v) => v.remote && v.noExperience && v.noDegree);
  console.log(`  удалённых: ${remote} · джуновского уровня: ${junior} · без высшего: ${noDegree}`);
  console.log(`  под все три фильтра: ${ok.length}`);
  for (const v of ok.slice(0, 15)) {
    console.log(`  ${v.externalId} | ${v.title.slice(0, 44).padEnd(44)} | ${v.company.slice(0, 18).padEnd(18)} | ${v.salaryFrom ?? '—'}-${v.salaryTo ?? '—'}`);
  }
  if (!ok.length) {
    console.log('  ни одной под все три фильтра — площадка не подходит под «без опыта»');
    const near = r.list.filter((v) => v.remote).slice(0, 8);
    console.log('  ближайшее (удалённые, любой уровень):');
    for (const v of near) console.log(`    ${v.title.slice(0, 50)} | ${v.company}`);
  }
  write('hsw/habr-raw.json', JSON.stringify(r.list, null, 1));
  console.log('\nсырой сбор: hsw/habr-raw.json');
}