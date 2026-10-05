// Сбор опубликованных адресов с сайтов компаний и их разделов вакансий.
//
// Что собирается. Только то, что компания разместила сама. Поле contacts.is_public
// всегда 1 — это не украшение, а граница: личные адреса вида ivan.petrov@
// не берутся никогда, даже если попались в разметке.
//
// Почему так. Измерено на шести собранных сайтах: отвечают все шесть, но адрес
// для отклика нашёлся у одного — job@techcoredev.ru. У трёх есть раздел вакансий,
// у трёх есть какая-то опубликованная почта, у Aston не нашлось ни того, ни
// другого. То есть деловые адреса — редкость, и «нашлось 1 из 6» это правда о
// компаниях, а не о неработающем сборщике.
//
// Как различаются адреса. Поле contacts.role заполняется словом hr только если
// в локальной части есть hr/recruit/career/talent/resume. Иначе роль пустая, и
// процент в окне этот контакт не засчитывает: адрес sales@ не равен контакту
// по вакансиям, и приравнивать их было бы враньём в самой цифре.
//
// Глубина обхода. Главная плюс её ссылки на разделы вакансий и контакты, плюс
// сами эти разделы. Глубже не идём: сайт не обязан отдавать гостю всё, а
// обход ради количества — это нагрузка без пользы. Глубина задаётся --depth.
//
// Запуск:
//   node hsw-site-contacts.js            все сайты из contacts
//   node hsw-site-contacts.js --limit 2  два сайта за прогон
//   node hsw-site-contacts.js --depth 3   глубже обойти разделы
//   node hsw-site-contacts.js --rewrite   пересобрать даже собранные
//   node hsw-site-contacts.js --dry-run   ничего не записывать

const https = require('https');
const { open, DB_FILE } = require('./hsw-db.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PAUSE_MS = 1200;
const MAX_HTML = 2000000;
// Больше 25 страниц на сайт обходить нет смысла: у динамических сайтов в
// раздел вакансий ведут сотни ссылок, а адреса от этого не появляются.
const MAX_PAGES_PER_SITE = 25;

// Слова, по которым адрес считается адресом для отклика, а не просто почтой.
const HR_WORDS = /(hr|recruit|career|talent|job|resume|hire)/i;

// Страница вакансий: по ссылке идём, по странице ищем адрес.
const CAREER_HREF = /(career|vacanc|job|hire|resume|rabot|razrabot|trudoustroystv|otklick)/i;

// Мусор в адресах: сервисные и выдуманные.
const MAIL_NOISE = /(sentry|@2x2images|@cdn|example\.(com|org|net)|@domain\.com|noreply|no-reply|postmaster|abuse|webmaster|@.*\.png|@.*\.jpg)/i;

// Почта, найденная не на домене компании — чужая (магазин, блог, CDN).
function sameDomain(mail, host) {
  const m = /@([a-zA-Z0-9.-]+)$/.exec(mail);
  if (!m) return false;
  const mailDomain = m[1].toLowerCase().replace(/^www\./, '');
  const h = host.replace(/^www\./, '').toLowerCase();
  return mailDomain === h || mailDomain.endsWith('.' + h);
}

// Личный адрес: имя или фамилия перед @. Не берём никогда — это данные о человеке.
const PERSONAL_LOCAL = /^[a-zа-я]{2,15}[._-][a-zа-я]{2,15}$|^(ivan|petrov|sergey|alex|dmitry|maxim|artem|pavel|andrey|kirill|ilya|nikita|roma|vlad|denis|egor|ivanov|petrov|sidorov|smirnov|kuznetsov|popov|novikov|orlov|lebedev|sokolov|morozov|volkov|alexeev|nikolaev|sergeev|fedorov|mikhailov|belyaev|tarasov|belov|komarov|orlova|petrova|smirnova|kuznetsova)/i;

function roleOf(mail) {
  const local = String(mail).split('@')[0];
  return HR_WORDS.test(local) ? 'hr' : null;
}

function isPersonal(mail) {
  return PERSONAL_LOCAL.test(String(mail).split('@')[0]);
}

function parseArgs(argv) {
  const out = { limit: 0, depth: 2, rewrite: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--depth') out.depth = Number(argv[++i]);
    else if (a === '--rewrite') out.rewrite = true;
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

function get(url, redirects) {
  redirects = redirects === undefined ? 3 : redirects;
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ru-RU,ru;q=0.9' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(get(new URL(res.headers.location, url).href, redirects - 1));
          return;
        }
        let body = '';
        res.on('data', (c) => { if (body.length < MAX_HTML) body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, ctype: String(res.headers['content-type'] || ''), finalUrl: url }));
      }
    );
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: '', ctype: '', finalUrl: url }); });
    req.on('error', (e) => resolve({ status: -1, body: '', ctype: '', finalUrl: url, error: e.message }));
  });
}

const MAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function mailsIn(html) {
  const set = new Set();
  let m;
  const re = new RegExp(MAIL_RE.source, 'g');
  while ((m = re.exec(html)) !== null) set.add(m[0].toLowerCase());
  // Адреса, на которые ведут mailto:. Их нет в тексте страницы как почта,
  // хотя в разметке они есть — и в контактах они самые честные: человек сам
  // поставил ссылку «написать в отдел подбора».
  const re2 = /mailto:([^"'?>\s]+)/gi;
  while ((m = re2.exec(html)) !== null) {
    const a = m[1].replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(a)) set.add(a);
  }
  return [...set];
}

function linksIn(html, base, pattern) {
  const out = new Set();
  let m;
  const re = /href="([^"]+)"/g;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, '&');
    if (href.startsWith('#')) continue;
    if (!pattern.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      out.add(u.href.split('#')[0]);
    } catch (e) {
      // Неразбираемая ссылка пропускается: битая ссылка не должна ронять обход.
    }
  }
  return [...out];
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function addContact(db, companyId, value, role, foundVia) {
  db.prepare(`
    INSERT INTO contacts (company_id, kind, value, channel, role, is_public, found_via, created_at)
    VALUES (?, 'public_business', ?, 'email', ?, 1, ?, ?)
    ON CONFLICT(company_id, channel, value) DO UPDATE SET role = COALESCE(contacts.role, excluded.role)
  `).run(companyId, value, role, foundVia, nowIso());
}

async function main() {
  const args = parseArgs(process.argv);
  const db = open(DB_FILE);

  try {
    let sql = "SELECT c.id AS company_id, c.name, ct.value AS site FROM contacts ct JOIN companies c ON c.id = ct.company_id WHERE ct.channel = 'site'";
    if (!args.rewrite) {
      sql += " AND NOT EXISTS (SELECT 1 FROM contacts e WHERE e.company_id = c.id AND e.channel = 'email')";
    }
    sql += ' ORDER BY c.id';
    let sites = db.prepare(sql).all();
    if (args.limit > 0) sites = sites.slice(0, args.limit);

    console.log('=== адреса с сайтов компаний ===');
    console.log('  сайтов к обходу: ' + sites.length + ', глубина: ' + args.depth + (args.dryRun ? ', --dry-run' : ''));
    if (!sites.length) {
      console.log('  нечего обходить. Сайты появляются после hsw-contacts.js.');
      return;
    }

    const stats = { pages: 0, failed: 0, mailFound: 0, mailKept: 0, personalSkipped: 0, foreignSkipped: 0, noiseSkipped: 0, hrFound: 0, duplicates: 0 };
    const found = [];

    for (const s of sites) {
      const host = (() => { try { return new URL(s.site).hostname; } catch (e) { return ''; } })();
      console.log('\n--- ' + s.name.slice(0, 40) + ' (' + s.site + ') ---');

      const queue = [{ url: s.site, depth: 0 }];
      const visited = new Set();
      // Уникальные адреса компании. Без этого на сайте из 26 страниц, где
      // один и тот же футер с двумя почтами, отчёт говорил бы «адресов
      // найдено 50» — то есть врал бы в 25 раз. Измерено: на techcoredev.ru
      // так и было, 2 уникальных адреса против 50 посчитанных.
      const companyMails = new Map();

      while (queue.length) {
        const item = queue.shift();
        if (visited.has(item.url)) continue;
        visited.add(item.url);
        if (visited.size > MAX_PAGES_PER_SITE) {
          console.log('    останов: больше ' + MAX_PAGES_PER_SITE + ' страниц на сайт');
          break;
        }

        const r = await get(item.url);
        await new Promise((res) => setTimeout(res, PAUSE_MS));

        if (r.status !== 200 || !r.body) {
          stats.failed++;
          console.log('    ' + r.status + ' ' + item.url.slice(0, 90));
          continue;
        }
        stats.pages++;

        // Адреса.
        for (const mail of mailsIn(r.body)) {
          stats.mailFound++;
          if (MAIL_NOISE.test(mail)) { stats.noiseSkipped++; continue; }
          if (!sameDomain(mail, host)) { stats.foreignSkipped++; continue; }
          if (isPersonal(mail)) {
            stats.personalSkipped++;
            console.log('    личный адрес пропущен: ' + mail);
            continue;
          }
          // Уже видели этот адрес на другой странице того же сайта.
          if (companyMails.has(mail)) {
            stats.duplicates++;
            continue;
          }
          const role = roleOf(mail);
          if (role === 'hr') stats.hrFound++;
          stats.mailKept++;
          companyMails.set(mail, role);
          found.push({ companyId: s.company_id, mail, role, via: item.url, name: s.name });
          console.log('    адрес: ' + mail + (role === 'hr' ? '  ← для отклика' : '  (не для отклика)'));
        }

        // Ссылки на разделы вакансий и контакты — если ещё есть куда идти.
        if (item.depth < args.depth) {
          for (const link of linksIn(r.body, item.url, CAREER_HREF)) {
            if (visited.has(link)) continue;
            // Не уходим на чужой домен: сайт агентства не страница работодателя.
            let linkHost = '';
            try { linkHost = new URL(link).hostname.replace(/^www\./, ''); } catch (e) { continue; }
            if (linkHost !== host.replace(/^www\./, '')) continue;
            queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      }

      console.log('    страниц прочитано: ' + visited.size + ', уникальных адресов: ' + companyMails.size);
    }

    if (!args.dryRun) {
      for (const f of found) addContact(db, f.companyId, f.mail, f.role, f.via);
    }

    console.log('\n=== итог ===');
    console.log('  страниц прочитано:   ' + stats.pages + ', не прочитано: ' + stats.failed);
    console.log('  адресов встречено:   ' + stats.mailFound + ' (в том числе повторов на разных страницах: ' + stats.duplicates + ')');
    console.log('  служебных отброшено: ' + stats.noiseSkipped);
    console.log('  чужих доменов:       ' + stats.foreignSkipped);
    console.log('  личных пропущено:    ' + stats.personalSkipped + ' (сбор данных о людях, не берём)');
    console.log('  записано:            ' + (args.dryRun ? 'нет (--dry-run)' : found.length) + ', из них для отклика: ' + stats.hrFound);
    if (!found.length) {
      console.log('\n  Ни одного опубликованного адреса. Это данные о компаниях, а не о сборе:');
      console.log('  деловые адреса публикуют единицы. Отклик идёт через форму на площадке.');
    }
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error('сбой: ' + e.stack);
  process.exitCode = 1;
});