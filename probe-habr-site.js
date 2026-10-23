// Проверяет, отдаёт ли Хабр сайт компании на странице вакансии.
//
// Задача. hh даёт сайт компании прямо со страницы работодателя (метка
// sidebar-company-site), и контакты собираются автоматически. У компаний с
// Хабра страницы работодателя на hh нет — там номер hh_id не заполнишь. Если
// Хабр тоже отдаёт сайт компании, контакты соберутся и для них.
//
// Проверяются все страницы хабровских вакансий из базы: важно, есть ли ссылка
// хотя бы у части компаний, а не у одной удачной.

const { DatabaseSync } = require('node:sqlite');
const { open, DB_FILE } = require('./hsw-db.js');
const habr = require('./habr-page.js');

const SERVICE = /(^|\.)(career\.habr\.com|habr\.com|habrcdn\.ru|assets\.habr\.com|habr\.media|dk\.ru|sentry\.io|sentry\.habr\.com|googleapis\.com|gstatic\.com|w3\.org|schema\.org|youtube\.com|youtu\.be|t\.me|fonts\.google|jsdelivr\.net|cdnjs\.cloudflare\.com|t\.co)$/i;

function externalLinks(html, base) {
  const out = new Set();
  let m;
  const re = /href="([^"]+)"/g;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, '&');
    let u;
    try { u = new URL(href, base); } catch (e) { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    if (SERVICE.test(u.hostname)) continue;
    out.add(u.href);
  }
  return [...out];
}

(async () => {
  const db = open(DB_FILE);
  const rows = db.prepare(`
    SELECT v.id, v.site_id, v.title, v.company_raw, v.company_id
    FROM vacancies v
    WHERE v.site = 'habr' AND v.is_open = 1
    ORDER BY v.id
  `).all();
  db.close();

  console.log('=== хабровских вакансий: ' + rows.length + ' ===');
  if (!rows.length) {
    console.log('  нет. Сначала node hsw-collect-habr.js');
    return;
  }

  let withSite = 0;
  const companySites = new Map();

  for (const v of rows) {
    const page = await habr.fetchVacancy(v.site_id);
    await habr.sleep(700);
    if (!page) {
      console.log('  ' + v.site_id + ' — страница не прочитана');
      continue;
    }
    const links = externalLinks(page.body, 'https://career.habr.com/vacancies/' + v.site_id);
    // Из ссылок оставляем те, что похожи на сайт компании: поддомены habr.com
    // уже отброшены, остаётся отсечь соцсети и трекеры.
    const looksLikeSite = links.filter((u) => {
      if (/vk\.com|facebook|twitter|t\.me|telegram|linkedin|hh\.ru|flamp\.ru|vc\.ru|boosty|gitlab\.com|github\.com/i.test(u)) return false;
      if (/\.(js|css|png|jpg|jpeg|svg|gif|webp|ico|pdf|woff2?)(\?|$)/i.test(u)) return false;
      return true;
    });
    console.log('  ' + v.site_id + ' ' + String(v.company_raw || '').slice(0, 30).padEnd(32) +
      ' внешних ссылок ' + links.length + ', похожих на сайт: ' + looksLikeSite.length);
    for (const u of looksLikeSite.slice(0, 4)) console.log('      ' + u.slice(0, 100));
    if (looksLikeSite.length) {
      withSite++;
      if (!companySites.has(v.company_raw)) companySites.set(v.company_raw, looksLikeSite[0]);
    }
  }

  console.log('\n=== итог ===');
  console.log('  вакансий с найденным сайтом компании: ' + withSite + ' из ' + rows.length);
  console.log('  компаний с сайтом: ' + companySites.size);
  for (const [name, site] of companySites) console.log('    ' + String(name).slice(0, 34).padEnd(36) + site.slice(0, 60));
  if (withSite === 0) {
    console.log('\n  Хабр сайт компании не отдаёт. Значит для хабровских компаний');
    console.log('  контакты придётся брать иначе — по названию через поиск hh,');
    console.log('  либо оставить их без контактов и не показывать это как «контактов нет».');
  }
})();