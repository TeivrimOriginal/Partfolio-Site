// Сбор контактов компаний. Это узкое место: пока контакты есть у 46 компаний
// из 190, потолок скоринга упирается в 71 балл из 100, и не потому что
// резюме плохо подходит, а потому что письмо некуда отправлять.
//
// Источники — только те, где компания публикует контакты сама:
//   1. карточка вакансии на hh (там бывает телеграм и телефон);
//   2. страница работодателя на hh (официальный сайт);
//   3. страницы «Контакты» на сайте компании.
//
// Чего здесь нет: выгрузок баз, чужих адресов, поиска по телефонам в
// справочниках. Адрес, который компания не публиковала, — это спам.
//
// Возобновляемость: каждая компания обрабатывается один раз, прогресс пишется
// в лог, повторный запуск добирает только новые. Без этого обход 190 компаний
// невозможно пережить при обрыве.

import fs from 'node:fs';
import { openDb, addContact, addSignal } from './db.mjs';
import { isPlatformContact } from './target.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const RETRY = [2000, 5000];
const PAUSE_MS = 700;
const SITE_PATHS = ['/contacts', '/contact', '/about', '/company', '/about/contact'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const strip = (h) => String(h || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const TEL_RE = /(?:\+7|8)[\s(]?\d{3}[\s)]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;
const TG_RE = /(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_+]{4,40})/g;

function cleanEmails(list) {
  const junk = /(png|jpg|jpeg|gif|svg|webp|@2x|sentry|example|sample|noreply|no-reply|donotreply|wixpress|schema\.org|cloudflare)/i;
  return [...new Set(list.map((s) => s.toLowerCase()))].filter((e) => !junk.test(e) && e.includes('.') && !e.startsWith('.'));
}

async function get(url) {
  for (let a = 0; a <= RETRY.length; a++) {
    if (a > 0) await sleep(RETRY[a - 1]);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 3000) return t;
    } catch { /* сеть рвётся routinely */ }
  }
  return '';
}

/** Адрес сайта: сначала из JSON-LD страницы работодателя, потом из сырой разметки. */
function siteFrom(html) {
  const ld = html.match(/"sameAs"\s*:\s*\[([^\]]{0,600})\]/);
  if (ld) {
    const urls = [...ld[1].matchAll(/https?:\/\/[^"\s,\]]+/g)].map((m) => m[0]);
    const site = urls.find((u) => !/(hh\.ru|hh)\//.test(u) && !/(vk\.com|facebook|twitter|linkedin|t\.me|instagram|youtube|telegram)/i.test(u));
    if (site) return site;
  }
  const href = html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(?:[^<]*)(?:сайт|site|company|website)/i);
  if (href) return href[1];
  const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="(https?:\/\/[^"]+)"/i);
  return canonical ? null : null;
}

function harvest(html, url, into) {
  const text = strip(html);
  for (const e of cleanEmails(text.match(EMAIL_RE) || [])) {
    into.push({ kind: 'email', value: e, sourceUrl: url });
  }
  for (const t of text.match(TEL_RE) || []) {
    into.push({ kind: 'phone', value: t.replace(/\s+/g, ' '), sourceUrl: url });
  }
  for (const m of html.matchAll(TG_RE)) {
    const handle = m[1];
    if (!/^(share|joinchat|telegram|faq|proxy|readmore|s\.)/i.test(handle)) {
      into.push({ kind: 'telegram', value: `@${handle}`, sourceUrl: url });
    }
  }
}

/** Компании без контактов: одна вакансия на компанию, чтобы не дублировать обход. */
export function queueWithoutContacts(db, limit) {
  return db.prepare(`
    SELECT v.* FROM vacancies v
    WHERE v.remote = 1
      AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.company_key = v.company_key)
      AND NOT EXISTS (SELECT 1 FROM signals s WHERE s.vacancy_id = v.id AND s.kind = 'contacts_tried')
    ORDER BY (SELECT COUNT(*) FROM vacancies x WHERE x.company_key = v.company_key) DESC, v.last_seen DESC
    LIMIT ?
  `).all(limit);
}

export async function harvestCompany(db, vacancy, { verbose = false } = {}) {
  const key = vacancy.company_key;
  if (!key) return { found: 0, reason: 'нет company_key' };

  const into = [];
  const notes = [];
  let site = null;

  // --- шаг 1: карточка вакансии на hh, один запрос на всё
  const html = await get(vacancy.url);
  if (html) {
    harvest(html, vacancy.url, into);
    const emp = html.match(/\/employer\/(\d+)/);
    if (emp) into.push({ kind: 'hh_employer', value: `https://hh.ru/employer/${emp[1]}`, sourceUrl: vacancy.url });

    // --- шаг 2: страница работодателя, там официальный сайт
    if (emp) {
      const empHtml = await get(`https://hh.ru/employer/${emp[1]}`);
      if (empHtml) {
        harvest(empHtml, `https://hh.ru/employer/${emp[1]}`, into);
        site = siteFrom(empHtml);
      }
    }
    if (!site) site = siteFrom(html);
  }

  if (site) into.push({ kind: 'site', value: site, sourceUrl: vacancy.url });

  // --- шаг 3: страницы контактов на сайте
  if (site) {
    const base = site.replace(/\/+$/, '');
    for (const p of SITE_PATHS) {
      if (into.some((c) => c.kind === 'email')) break;
      const pageHtml = await get(base + p);
      if (!pageHtml) continue;
      const before = into.length;
      harvest(pageHtml, base + p, into);
      notes.push(`${p}: +${into.length - before}`);
      await sleep(250);
    }
  }

  let added = 0;
  // Сколько нашлось адресов площадки: их addContact не примет, но в отчёте
  // видно, что страница работодателя на hh насыщена служебными контактами
  // самой площадки — иначе выглядит так, будто сборщик сломался.
  let platform = 0;
  for (const c of into) {
    if (isPlatformContact(c.value, c.kind)) { platform++; continue; }
    if (addContact(db, { companyKey: key, vacancyId: vacancy.id, ...c })) added++;
  }
  if (added) {
    addSignal(db, vacancy.id, 'contacts_found', String(added));
    if (site) addSignal(db, vacancy.id, 'has_site', '1');
  }
  // Отметка «пробовали» — чтобы не копать одну и ту же компанию по второму кругу.
  addSignal(db, vacancy.id, 'contacts_tried', added ? String(added) : '0');
  if (verbose) {
    const pl = platform ? `, минус контакты площадки: ${platform}` : '';
    console.log(`  ${(vacancy.company || key).slice(0, 28).padEnd(28)} +${added} ${notes.join(' ')}${pl}`);
  }
  return { found: added, notes, platform };
}

async function main() {
  const db = openDb();
  const limit = Number(process.argv[2] || 40);
  const rows = queueWithoutContacts(db, limit);
  console.log(`компаний к обходу: ${rows.length}\n`);

  let total = 0;
  let empty = 0;
  const started = Date.now();
  for (const [i, v] of rows.entries()) {
    try {
      const r = await harvestCompany(db, v, { verbose: true });
      total += r.found;
      if (!r.found) empty++;
    } catch (e) {
      console.log(`  ОШИБКА ${v.company}: ${e && e.message}`);
    }
    if ((i + 1) % 10 === 0) {
      const sec = Math.round((Date.now() - started) / 1000);
      console.log(`  …${i + 1}/${rows.length}, контактов +${total}, пустых ${empty}, ${sec} с`);
    }
    await sleep(PAUSE_MS);
  }

  const stats = db.prepare('SELECT kind, COUNT(*) c FROM contacts GROUP BY kind ORDER BY c DESC').all();
  const companies = db.prepare('SELECT COUNT(DISTINCT company_key) c FROM contacts').get().c;
  console.log(`\nдобавлено ${total} записей, компаний без контактов ${empty}`);
  console.log('по типам:', stats.map((r) => `${r.kind}=${r.c}`).join(' | '));
  console.log(`компаний с контактами: ${companies}`);
}

if (process.argv[1] && process.argv[1].endsWith('collect-contacts.mjs')) {
  main().catch((e) => { console.error('упало:', e && e.stack); process.exit(1); });
}
