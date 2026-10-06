// Сбор вакансий Хабра в базу HardSearchWork.
//
// Устройство повторяет сборщик hh, потому что Хабр отдаёт то же самое в том же
// виде: список — RSS, полный текст — страница вакансии. Разница в трёх вещах,
// и все три измерены, а не предположены:
//
//  1) Уровень приходит ТЕГОМ (#junior, #intern, #middle, #senior, #lead), а не
//     отдельным полем. Без тегов запрос «стажёр» находит и Middle, поэтому
//     уровень проверяется обязательно: ТЗ требует intern/junior.
//  2) Удалённость приходит словами «Можно удалённо» в сводке RSS и полем в
//     описании. Поле «удалённая работа полностью» из ТЗ в проверку не входит:
//     это запрещённая формулировка для письма, а не условие отбора.
//  3) Гость видит описание вакансии целиком. Заглушка «Авторизуйтесь» заменяет
//     только кнопку отклика. Первое прочтение страницы выглядело как «гостю
//     ничего не отдают», потому что искали слова «Опыт работы», которых на
//     Хабре в разметке нет: требования лежат тегами.
//
// Страница career.habr.com/vacancies — SPA, data-qa в ней нет ни одного, для
// списка не годится. RSS отдаёт 50 записей на запрос, параметр per_page
// игнорируется площадкой.
//
// Запуск:
//   node hsw-collect-habr.js                пачка 10, приоритет python
//   node hsw-collect-habr.js --batch 20
//   node hsw-collect-habr.js --pages 2      страниц RSS на запрос
//   node hsw-collect-habr.js --dry-run      без записи

const { open, DB_FILE, upsertCompany } = require('./hsw-db.js');
const { screen, stackOf, STACK_ORDER } = require('./hsw-screen.js');
const habr = require('./habr-page.js');

// Запросы по стекам. Приоритет тот же, что на hh: python первым.
const QUERIES = [
  { stack: 'python', q: 'python' },
  { stack: 'devops', q: 'devops' },
  { stack: 'qa', q: 'qa тестировщик' },
  { stack: 'backend', q: 'backend python' },
];

// Руководящие роли отсекаются по заголовку.
//
// Причина, измеренная на живых вакансиях: «Руководитель проектов внедрения
// (Technical Project Lead)» и «Data Scientist RecSys» проходили фильтр, потому
// что у них нет НИ тега уровня, НИ слова junior — проверено прямо на страницах.
// Проходили они потому, что screen() отклоняет по уровню только когда уровень
// указан и не junior, а пустой уровень пропускает без проверки.
const LEADERSHIP = /\b(руководител[ьия]|директор|менеджер|архитектор|ведущи[йя]|главн(ый|ого)|тимлид|техлид|manager|lead|leader|director|chief|principal|architect|owner|co-?founder|основател[ьия])\b/i;

// Уровень берётся из ТЕГА, а если тега нет — из заголовка. Именно из заголовка,
// а не из описания: в описании почти всегда есть слова про junior в тексте
// компании, и поиск по всему описанию давал ложный junior.
function levelFromTitle(title, tag) {
  if (tag) return tag;
  const m = /\b(intern|internship|junior|trainee|стажёр|стажер|стажировка)\b/i.exec(String(title || ''));
  return m ? m[1].toLowerCase() : '';
}

// Предел на компанию в пачке. Такой же, как на hh: десять вакансий одного
// работодателя — это десять одинаковых писем, а не десять шансов.
const MAX_PER_COMPANY = 2;

function parseArgs(argv) {
  const out = { batch: 10, pages: 1, deep: 0, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--batch') out.batch = Number(argv[++i]);
    else if (a === '--pages') out.pages = Number(argv[++i]);
    else if (a === '--deep') out.deep = Number(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
  }
  if (!out.deep) out.deep = out.batch * 2;
  return out;
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function insertVacancy(db, v) {
  const stamp = nowIso();
  db.prepare(`
    INSERT INTO vacancies
      (site, site_id, url, title, company_id, company_raw, remote, no_experience,
       no_education, salary_from, stack, experience_floor_months, description,
       requirements, published, first_seen, last_seen, is_open)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(site, site_id) DO UPDATE SET
      url = excluded.url, title = excluded.title,
      company_id = excluded.company_id, company_raw = excluded.company_raw,
      remote = excluded.remote, no_experience = excluded.no_experience,
      no_education = excluded.no_education, salary_from = excluded.salary_from,
      stack = excluded.stack, description = excluded.description,
      requirements = excluded.requirements, published = excluded.published,
      last_seen = excluded.last_seen, is_open = 1
  `).run(
    v.site, v.site_id, v.url, v.title, v.company_id, v.company_raw,
    v.remote, v.no_experience, v.no_education, v.salary_from, v.stack,
    null, v.description, v.requirements, v.published, stamp, stamp
  );
  return db.prepare('SELECT id FROM vacancies WHERE site = ? AND site_id = ?').get(v.site, v.site_id).id;
}

function stackRank(stack) {
  const i = STACK_ORDER.indexOf(stack);
  return i < 0 ? STACK_ORDER.length : i;
}

async function main() {
  const args = parseArgs(process.argv);
  const db = open(DB_FILE);

  const stats = {
    seen: 0, candidates: 0, fresh: 0, verified: 0, rejected: 0,
    unreadable: 0, alreadyKnown: 0, byCompany: new Map(),
    rejectedBy: new Map(),
    droppedByCompany: 0,
  };
  const batch = [];

  try {
    console.log('=== сбор Хабра, приоритет: ' + QUERIES.map((q) => q.stack).join(' → ') + ' ===');

    // --- кандидаты из RSS ---
    const candidates = [];
    const seenIds = new Set();
    for (const q of QUERIES) {
      for (let p = 1; p <= args.pages; p++) {
        const items = await habr.fetchFeed({ q: q.q, remote: true, page: p });
        if (!items.length) {
          console.log('  «' + q.q + '» стр. ' + p + ': пусто — конец выдачи или площадка не отдала');
          break;
        }
        let added = 0;
        for (const it of items) {
          stats.seen++;
          if (seenIds.has(it.id)) continue;
          seenIds.add(it.id);
          // Уровень отсекаем сразу, ДО похода на страницу. Экономит половину
          // запросов: на выдаче python 31 вакансия из 50 без метки junior или
          // intern, и все они заведомо не подходят по ТЗ.
          if (it.level && !/intern|junior|стаж|student|trainee/i.test(it.level)) {
            stats.rejected++;
            stats.rejectedBy.set('уровень ' + it.level, (stats.rejectedBy.get('уровень ' + it.level) || 0) + 1);
            continue;
          }
          if (!it.remoteFromFeed) {
            stats.rejected++;
            stats.rejectedBy.set('не удалённая по сводке', (stats.rejectedBy.get('не удалённая по сводке') || 0) + 1);
            continue;
          }
          candidates.push({ ...it, queryStack: q.stack });
          added++;
        }
        console.log('  «' + q.q + '» стр. ' + p + ': ' + items.length + ' шт., после отсева по уровню и удалённости новых ' + added);
        await habr.sleep(400);
      }
    }
    stats.candidates = candidates.length;
    console.log('  кандидатов после дешёвого отсева: ' + candidates.length);

    candidates.sort((a, b) => stackRank(stackOf(a.title, a.stackTags.join(' '))) - stackRank(stackOf(b.title, b.stackTags.join(' '))));

    // --- полная проверка ---
    let budget = args.deep;
    for (const c of candidates) {
      if (budget <= 0) break;
      const prev = db.prepare('SELECT id, is_open FROM vacancies WHERE site = ? AND site_id = ?').get('habr', c.id);
      if (prev && prev.is_open === 1) { stats.alreadyKnown++; continue; }

      budget--;
      const page = await habr.fetchVacancy(c.id);
      await habr.sleep(habr.PAUSE_MS || 900);

      if (!page) {
        stats.unreadable++;
        console.log('  ' + c.id + ' ' + c.title.slice(0, 46) + ' — страница не прочитана');
        continue;
      }
      const v = habr.parseVacancyPage(page.body);
      stats.fresh++;

      if (v.closed || c.closed) {
        stats.rejected++;
        console.log('  ' + c.id + ' ОТСЕВ: вакансия закрыта');
        continue;
      }
      const companyRaw = v.company || c.company;
      if (!companyRaw) {
        stats.rejected++;
        console.log('  ' + c.id + ' ОТСЕВ: компания не извлеклась');
        continue;
      }
      if (!v.description) {
        stats.rejected++;
        stats.rejectedBy.set('описание пустое', (stats.rejectedBy.get('описание пустое') || 0) + 1);
        console.log('  ' + c.id + ' ОТСЕВ: описание не прочиталось — ' + v.title.slice(0, 40));
        continue;
      }

      // Уровень: тег из RSS, а если его нет — слово в заголовке.
      const realTitle = v.title || c.title;
      const level = levelFromTitle(realTitle, c.level);

      if (LEADERSHIP.test(realTitle)) {
        stats.rejected++;
        stats.rejectedBy.set('руководящая роль в заголовке', (stats.rejectedBy.get('руководящая роль в заголовке') || 0) + 1);
        console.log('  ' + c.id + ' ОТСЕВ: руководящая роль — ' + realTitle.slice(0, 55));
        continue;
      }

      const text = [v.description, c.summary].filter(Boolean).join(' \n ');
      const remoteField = c.remoteFromFeed || /Можно удалённо|удалённая работа|remote/i.test(text);
      const verdict = screen({ description: text, remoteField, level });
      const stack = stackOf(v.title || c.title, text + ' ' + c.stackTags.join(' '));

      if (!verdict.ok) {
        stats.rejected++;
        stats.rejectedBy.set(verdict.why, (stats.rejectedBy.get(verdict.why) || 0) + 1);
        console.log('  ' + c.id + ' ОТСЕВ (' + stack + '): ' + verdict.why + ' — ' + (v.title || c.title).slice(0, 50));
        continue;
      }

      const link = upsertCompany(db, companyRaw, { site: 'habr', source: 'habr-rss' });
      const canon = db.prepare('SELECT name FROM companies WHERE id = ?').get(link.id);
      const perCompany = stats.byCompany.get(link.id) || 0;
      const inBatch = perCompany < MAX_PER_COMPANY;
      if (!inBatch) stats.droppedByCompany++;
      stats.byCompany.set(link.id, perCompany + 1);

      const salaryFrom = (/\b(\d[\d  ]*)\s*₽/.exec(c.salary || v.description || '') || [])[1];

      stats.verified++;
      const row = {
        site: 'habr',
        site_id: c.id,
        url: c.url,
        title: v.title || c.title,
        company_id: link.id,
        company_raw: canon ? canon.name : companyRaw,
        remote: verdict.remote === 'full' ? 1 : 0,
        no_experience: 1,
        no_education: 1,
        salary_from: salaryFrom ? Number(String(salaryFrom).replace(/\s/g, '')) : null,
        stack,
        description: v.description.slice(0, 8000),
        // Пустой уровень записывается словами «уровень не указан», а не пустотой: в
        // письме и в окне должно быть видно, что это допущение, а не факт.
        requirements: (level ? 'уровень: ' + level + '; ' : 'уровень не указан; ') + 'теги: ' + c.tags.join(', ') + (c.schedule ? '; ' + c.schedule : ''),
        published: c.published,
      };
      batch.push({ row, stack, inBatch, company: row.company_raw, level });
      console.log('  ' + c.id + (inBatch ? ' БЕРЁМ' : ' В БАЗУ, вне пачки') + ' (' + stack + ', ' + verdict.remote +
        (level ? ', ' + level : '') + '): ' + row.title.slice(0, 45) + ' — ' + row.company_raw);
    }

    batch.sort((a, b) => stackRank(a.stack) - stackRank(b.stack));
    if (!args.dryRun) for (const b of batch) insertVacancy(db, b.row);

    const showBatch = batch.filter((b) => b.inBatch).slice(0, args.batch);
    const outside = batch.filter((b) => !b.inBatch);

    console.log('\n=== итог ===');
    console.log('  просмотрено из RSS:  ' + stats.seen);
    console.log('  после отсева по тегам: ' + stats.candidates + ' (остальное отсеяно без похода на страницу)');
    console.log('  уже были в базе:     ' + stats.alreadyKnown);
    console.log('  прочитано полностью: ' + stats.fresh);
    console.log('  прошли фильтр:       ' + stats.verified);
    console.log('  отсеяно:             ' + stats.rejected);
    console.log('  не прочитано:        ' + stats.unreadable);
    console.log('  записано в базу:     ' + (args.dryRun ? 'нет (--dry-run)' : batch.length));
    console.log('  в пачке:             ' + showBatch.length + ', компаний: ' + stats.byCompany.size);
    console.log('  вне пачки:           ' + outside.length + ' (предел ' + MAX_PER_COMPANY + ' на компанию)');

    if (stats.rejectedBy.size) {
      console.log('\n  причины отсева:');
      for (const [why, n] of [...stats.rejectedBy.entries()].sort((a, b) => b[1] - a[1])) {
        console.log('    ' + String(n).padStart(3) + '  ' + why);
      }
    }

    if (showBatch.length) {
      console.log('\n=== пачка ' + showBatch.length + ' (приоритет python первым) ===');
      showBatch.forEach((b, i) => {
        console.log('  ' + String(i + 1).padStart(2) + '. [' + b.stack + (b.level ? '/' + b.level : '') + '] ' + b.row.title);
        console.log('      ' + b.company + '  ' + b.row.url);
      });
    } else {
      console.log('\n  пачка пуста.');
      if (stats.unreadable) console.log('  Часть страниц не прочитана (' + stats.unreadable + ') — нужен повтор.');
    }
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error('сбой сбора: ' + e.stack);
  process.exitCode = 1;
});