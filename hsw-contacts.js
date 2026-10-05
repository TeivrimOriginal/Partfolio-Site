// Сбор контактов компаний: страница работодателя hh, затем сайт компании.
//
// Что собирается. Только опубликованное — это зафиксировано в схеме полем
// contacts.is_public, которое всегда 1. Обоснование измерено: на странице
// работодателя hh публичного делового телефона нет вовсе (проверено на Aston),
// а почты в разметке принадлежат инфраструктуре площадки — sentry.hh.ru и
// dreamjob.ru. То есть телефон и телеграм сотрудников там не публикуются, и
// добывать их неоткуда: это был бы сбор данных о людях, а не поиск работы.
// Берётся то, что компания разместила сама: сайт, страница вакансии,
// ссылка на аккаунт на hh.
//
// Откуда берётся. Страница работодателя отдаёт 200 без входа (проверено на
// Aston, 1.4 МБ) и содержит сайт компании в блоке sidebar-company-site.
// Метки выбраны из разметки после того, как восемь предположений
// (employer-name, employer-site и подобные) вернули пустоту. Рабочие:
// company-header-title-name, company-info-address, company-info-industries,
// sidebar-company-site.
//
// Что НЕ делается. Не вытаскиваются телефоны и телеграм-аккаунты сотрудников
// оттуда, где их не публиковали. Не обходятся ограничения площадки. Если на
// hh вход нужен для отправки, сбор идёт по открытым страницам, а вход
// подключается отдельно и только для отправки.
//
// Запуск:
//   node hsw-contacts.js              все компании без собранных контактов
//   node hsw-contacts.js --limit 3    три компании за прогон
//   node hsw-contacts.js --company 4  одна компания по id
//   node hsw-contacts.js --rewrite    пересобрать даже те, что уже собраны

const { open, DB_FILE } = require('./hsw-db.js');
const hh = require('./hh-page.js');

// Сайты, которые принадлежат площадке или инфраструктуре, а не компании.
// Без фильтра в контакты попадают setka.ru и sentry.hh.ru — то есть мусор,
// который потом выглядит как найденный контакт компании.
const SERVICE_DOMAINS = /(^|\.)(hh\.ru|zarechny\.hh\.ru|hhcdn\.ru|hh\.agent|setka\.ru|dreamjob\.ru|sentry\.io|sentry\.hh\.ru|googleapis\.com|gstatic\.com|w3\.org|schema\.org|jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.google|youtu\.be|youtube\.com|t\.co|t\.me|hh\.media)$/i;

function isCompanySite(url) {
  if (!url) return false;
  if (SERVICE_DOMAINS.test(url)) return false;
  return /^https?:\/\//i.test(url);
}

function parseArgs(argv) {
  const out = { limit: 0, companyId: null, rewrite: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--company') out.companyId = Number(argv[++i]);
    else if (a === '--rewrite') out.rewrite = true;
  }
  return out;
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Приводит адрес к виду без слэшей и параметров: https://astondevs.ru/ → astondevs.ru
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return String(url || '').trim().toLowerCase();
  }
}

function addContact(db, companyId, contact) {
  db.prepare(`
    INSERT INTO contacts (company_id, kind, value, channel, role, is_public, found_via, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(company_id, channel, value) DO NOTHING
  `).run(
    companyId, contact.kind, contact.value, contact.channel,
    contact.role || null, contact.found_via, nowIso()
  );
}

// Страница работодателя hh. Возвращает то, что там опубликовано.
async function readEmployerPage(employerId) {
  for (const host of hh.HOSTS) {
    const r = await hh.fetchOnce('https://' + host + '/employer/' + employerId);
    if (r.status === 200 && r.body.length > 50000) {
      const site = hh.qa(r.body, 'sidebar-company-site');
      return {
        ok: true,
        name: hh.qa(r.body, 'company-header-title-name'),
        address: hh.qa(r.body, 'company-info-address'),
        industries: hh.qa(r.body, 'company-info-industries'),
        site: isCompanySite(site) ? site : null,
        rawSite: site,
        url: 'https://hh.ru/employer/' + employerId,
      };
    }
    await hh.sleep(2500);
  }
  return { ok: false, rawSite: '', url: 'https://hh.ru/employer/' + employerId };
}

async function main() {
  const args = parseArgs(process.argv);
  const db = open(DB_FILE);

  try {
    let sql = 'SELECT * FROM companies WHERE hh_id IS NOT NULL AND hh_id <> \'\'';
    const params = [];
    if (args.companyId) {
      sql += ' AND id = ?';
      params.push(args.companyId);
    } else if (!args.rewrite) {
      sql += ' AND fully_collected = 0';
    }
    sql += ' ORDER BY id';
    let rows = db.prepare(sql).all(...params);
    if (args.limit > 0) rows = rows.slice(0, args.limit);

    console.log('=== сбор контактов ===');
    console.log('  компаний к обработке: ' + rows.length + (args.rewrite ? ' (--rewrite)' : ' (без собранных контактов)'));
    if (!rows.length) {
      console.log('  нечего собирать. Номера hh_id проставляет hsw-backfill-employer.js.');
      return;
    }

    const stats = { done: 0, pagesOk: 0, pagesFail: 0, site: 0, hhPage: 0, contacts: 0 };

    for (const c of rows) {
      const info = await readEmployerPage(c.hh_id);
      await hh.sleep(hh.PAUSE_MS);

      if (!info.ok) {
        stats.pagesFail++;
        console.log('  ' + c.id + ' ' + String(c.name).slice(0, 40) + ' — страница работодателя не пришла');
        continue;
      }
      stats.pagesOk++;

      let found = 0;
      // Сайт компании — главный публичный контакт: с него потом берётся
      // раздел careers и адреса hr@/careers@.
      if (info.site) {
        addContact(db, c.id, {
          kind: 'public_business',
          value: info.site,
          channel: 'site',
          role: null,
          found_via: 'hh:employer/' + c.hh_id,
        });
        stats.site++;
        found++;
      } else if (info.rawSite) {
        // Сайт есть, но он служебный. Это надо видеть, иначе «контактов 0»
        // выглядит как «компания ничего не публикует».
        console.log('  ' + c.id + ' ' + String(c.name).slice(0, 34) + ' — сайт в блоке есть, но служебный: ' + info.rawSite);
      }

      // Страница работодателя на hh сама по себе контакт: по ней можно
      // написать, и она опубликована.
      addContact(db, c.id, {
        kind: 'public_business',
        value: info.url,
        channel: 'hh',
        role: null,
        found_via: 'hh:employer/' + c.hh_id,
      });
      stats.hhPage++;
      found++;

      stats.contacts += found;
      stats.done++;

      // Обновляем сведения о компании попутно: адрес и отрасль приходят с той же
      // страницы, и повторно идти за ними незачем.
      db.prepare('UPDATE companies SET city = COALESCE(city, ?), about = COALESCE(about, ?), last_seen = ? WHERE id = ?')
        .run(info.address || null, info.industries || null, nowIso(), c.id);

      db.prepare('UPDATE companies SET fully_collected = 1 WHERE id = ?').run(c.id);

      console.log('  ' + c.id + ' ' + String(c.name).slice(0, 30).padEnd(32) +
        ' → ' + found + ' контакт(а)' + (info.site ? ', сайт ' + hostOf(info.site) : ', без сайта') +
        (info.address ? ', ' + info.address.slice(0, 30) : ''));
    }

    console.log('\n=== итог ===');
    console.log('  компаний обработано: ' + stats.done);
    console.log('  страниц работодателя: прочитано ' + stats.pagesOk + ', не пришло ' + stats.pagesFail);
    console.log('  контактов записано:  ' + stats.contacts + ' (из них сайтов ' + stats.site + ')');

    const left = db.prepare('SELECT COUNT(*) c FROM companies WHERE fully_collected = 0').get().c;
    console.log('  компаний без собранных контактов осталось: ' + left);
    console.log('\n  Что дальше: сайт компании ведёт в раздел careers, оттуда берутся hr@ и careers@.');
    console.log('  Личные телефоны и телеграм-аккаунты сотрудников не публикуются нигде — их поиск');
    console.log('  означал бы сбор данных о людях, а не поиск работы.');
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error('сбой сбора контактов: ' + e.stack);
  process.exitCode = 1;
});