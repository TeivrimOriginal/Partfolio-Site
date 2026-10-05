// Сбор вакансий hh в базу HardSearchWork.
//
// Что делает. Забирает выдачу hh по трём условиям ТЗ (удалённо, без опыта, без
// высшего), отбирает те, что действительно им соответствуют, и кладёт в базу
// пачками по 10 с приоритетом python.
//
// Почему в два прохода. Список кандидатов берётся из RSS: это 8.8 КБ вместо
// 1.28 МБ HTML и он не зависит от классов magritte-*, которые hh меняет
// регулярно. Но в RSS нет полного описания вакансии, а без него нельзя
// отсеять «требуется высшее образование». Поэтому:
//   1) RSS даёт кандидатов дёшево и быстро;
//   2) карточка каждого кандидата читается один раз и проверяется полностью.
// Проверяются только те, до кого дошла очередь до пачки: глубокая проверка
// стоит похода на страницу, а работать мы всё равно собираемся с десятью.
//
// Что считается отсевом, а что — непрочитанным. Отсев пишется в базу с причиной
// (вакансии.why), непрочитанное остаётся кандидатом без записи. Иначе отчёт
// «0 вакансий» смешивает «условия не подошли» и «hh не отдал страницу» —
// это разные вещи, и второе требует повтора, а не вывода «подходящих нет».
//
// Использование:
//   node hsw-collect.js                  пачка 10, приоритет python
//   node hsw-collect.js --batch 20        пачка 20
//   node hsw-collect.js --pages 3         три страницы выдачи на запрос
//   node hsw-collect.js --deep 30         проверить 30 кандидатов (а не только пачку)
//   node hsw-collect.js --text "python"   только один запрос

const { open, DB_FILE, upsertCompany, findCompany } = require('./hsw-db.js');
const { screen, stackOf, STACK_ORDER } = require('./hsw-screen.js');
const hh = require('./hh-page.js');

// Запросы по стекам в порядке приоритета ТЗ. python идёт первым не по привычке,
// а потому что это единственный стек, для которого в hh реально много вакансий
// без опыта и без высшего.
const QUERY_BY_STACK = {
  python: 'python',
  devops: 'devops',
  qa: 'qa инженер тестировщик',
  backend: 'backend разработчик',
};

// Общие фильтры выдачи. Они же — гарантия площадки, а не наш вывод:
// experience=noExperience и work_format=REMOTE отдают только то, что hh сам
// считает удалённым и без опыта. Дальше всё равно проверяем по описанию,
// потому что фильтр площадки отвечает за метку, а не за текст вакансии.
const BASE_PARAMS = 'area=113&experience=noExperience&work_format=REMOTE&order_by=publication_time&ored_clusters=true';

// Сколько вакансий одной компании допускается в одной пачке.
const MAX_PER_COMPANY = 2;

function parseArgs(argv) {
  const out = { batch: 10, pages: 2, deep: 0, text: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--batch') out.batch = Number(argv[++i]);
    else if (a === '--pages') out.pages = Number(argv[++i]);
    else if (a === '--deep') out.deep = Number(argv[++i]);
    else if (a === '--text') out.text = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
  }
  if (!out.text) {
    // Глубокая проверка стоит похода на страницу, а отсевается примерно
    // половина кандидатов. Измерено на прогоне 06.10.2026: из 10 прочитанных
    // прошли 5, и пачка осталась недобранной. Поэтому бюджет проверки вдвое
    // больше размера пачки — иначе «пачка 10» систематически даёт 5-7.
    if (!out.deep) out.deep = out.batch * 2;
  }
  return out;
}

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Есть ли такая вакансия в базе и открыта ли она.
function knownVacancy(db, site, siteId) {
  const row = db.prepare('SELECT id, is_open, last_seen FROM vacancies WHERE site = ? AND site_id = ?').get(site, siteId);
  return row || null;
}

function insertVacancy(db, v) {
  const stamp = nowIso();
  db.prepare(`
    INSERT INTO vacancies
      (site, site_id, url, title, company_id, company_raw, remote, no_experience,
       no_education, salary_from, stack, experience_floor_months, description,
       requirements, published, first_seen, last_seen, is_open)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(site, site_id) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      company_id = excluded.company_id,
      company_raw = excluded.company_raw,
      remote = excluded.remote,
      no_experience = excluded.no_experience,
      no_education = excluded.no_education,
      salary_from = excluded.salary_from,
      stack = excluded.stack,
      description = excluded.description,
      requirements = excluded.requirements,
      published = excluded.published,
      last_seen = excluded.last_seen,
      is_open = 1
  `).run(
    v.site, v.site_id, v.url, v.title, v.company_id, v.company_raw,
    v.remote, v.no_experience, v.no_education, v.salary_from, v.stack,
    v.experience_floor_months, v.description, v.requirements,
    v.published, stamp, stamp
  );
  return db.prepare('SELECT id FROM vacancies WHERE site = ? AND site_id = ?').get(v.site, v.site_id).id;
}

// Отметить вакансию закрытой: она пропала из выдачи. Не удаляем — по истории
// видно, куда уже откликались.
function markClosed(db, site, siteId) {
  const r = db.prepare('UPDATE vacancies SET is_open = 0, last_seen = ? WHERE site = ? AND site_id = ? AND is_open = 1')
    .run(nowIso(), site, siteId);
  return r.changes;
}

async function fetchRss(text, page) {
  const url = 'https://' + hh.HOSTS[0] + '/search/vacancy/rss?text=' + encodeURIComponent(text) + '&' + BASE_PARAMS + '&page=' + page;
  const r = await hh.fetchOnce(url);
  if (r.status !== 200 || !r.body.includes('<item')) return [];
  return hh.parseRss(r.body);
}

// Порядок стека внутри пачки. Индекс в STACK_ORDER — это и есть приоритет,
// поэтому сортировка одна и та же и для вакансий, и для писем: письмо по
// python всегда выше письма по frontend независимо от того, что раньше нашлось.
function stackRank(stack) {
  const i = STACK_ORDER.indexOf(stack);
  return i < 0 ? STACK_ORDER.length : i;
}

async function main() {
  const args = parseArgs(process.argv);
  const queries = args.text
    ? [{ stack: 'python', text: args.text }]
    : Object.keys(QUERY_BY_STACK).map((s) => ({ stack: s, text: QUERY_BY_STACK[s] }));

  const db = open(DB_FILE);
  const stats = {
    seen: 0, fresh: 0, verified: 0, rejected: 0, unreadable: 0, closed: 0, alreadyKnown: 0,
    droppedByCompany: 0,
    byCompany: new Map(),
  };
  const batch = [];

  try {
    console.log('=== сбор hh, приоритет: ' + (args.text ? args.text : STACK_ORDER.filter((s) => QUERY_BY_STACK[s]).join(' → ')) + ' ===');

    // --- 1. кандидаты из RSS ---
    const candidates = [];
    const seenIds = new Set();
    for (const q of queries) {
      for (let p = 0; p < args.pages; p++) {
        const items = await fetchRss(q.text, p);
        if (items.length === 0) {
          console.log('  запрос «' + q.text + '» страница ' + p + ': пусто — конец выдачи или троттлинг');
          break;
        }
        let added = 0;
        for (const it of items) {
          stats.seen++;
          if (seenIds.has(it.id)) continue;
          seenIds.add(it.id);
          candidates.push({ ...it, queryStack: q.stack });
          added++;
        }
        console.log('  запрос «' + q.text + '» страница ' + p + ': ' + items.length + ' шт., новых ' + added);
        await hh.sleep(400);
      }
    }
    console.log('  кандидатов всего: ' + candidates.length);

    // Кандидаты сортируются так же, как готовая пачка: python первым.
    candidates.sort((a, b) => stackRank(stackOf(a.title, '')) - stackRank(stackOf(b.title, '')));

    // --- 2. полная проверка до пачки ---
    let budget = args.deep;
    for (const c of candidates) {
      // Цикл идёт до лимита глубокой проверки, а не до размера пачки: в базу
      // попадают все прошедшие вакансии, а пачка — это первая десять из них
      // после сортировки по стеку. Останавливать сбор на размере пачки означало
      // бы выбрасывать проверенные вакансии впустую.
      if (budget <= 0) break;

      // Уже известная открытая вакансия: повторно по её карточке не ходим.
      // Бюджет глубокой проверки здесь НЕ расходуется: дальше идёт поход на
      // страницу, а этой вакансии он не нужен. Раньше счётчик стоял выше этой
      // проверки, и пять уже известных вакансий съедали пять из двадцати
      // проверок — из-за чего пачка 10 устойчиво приходила недобранной.
      // Счётчик ведётся отдельно, иначе «прочитано полностью» окажется меньше
      // «прошли фильтр», и непонятно, куда делись вакансии.
      const prev = knownVacancy(db, 'hh', c.id);
      if (prev && prev.is_open === 1) { stats.alreadyKnown++; continue; }

      budget--;
      const page = await hh.fetchVacancy(c.id, { attempts: 2 });
      await hh.sleep(hh.PAUSE_MS);

      if (!page) {
        stats.unreadable++;
        console.log('  ' + c.id + ' ' + c.title.slice(0, 50) + ' — страница не прочитана, кандидат остаётся');
        continue;
      }

      const v = hh.parseVacancy(page.body, c.id);
      stats.fresh++;

      if (v.archived) {
        stats.rejected++;
        console.log('  ' + c.id + ' ОТСЕВ: в архиве');
        continue;
      }
      // Компания из карточки надёжнее, чем из RSS: в RSS она вырезана из сводки
      // регуляркой, которая на названиях с двоеточием и запятой ошибается.
      const companyRaw = v.company || c.company;
      if (!companyRaw) {
        stats.rejected++;
        console.log('  ' + c.id + ' ОТСЕВ: компания не извлеклась');
        continue;
      }

      // Полная проверка по тексту вакансии. remoteField — метка hh из карточки,
      // а не наше предположение: «Формат работы: удалённо» это подтверждает.
      const text = [v.experience, v.workFormat, v.schedule, v.description].filter(Boolean).join(' \n ');
      const remoteField = /удалённо|удаленно|remote/i.test(v.workFormat);
      const level = ''; // уровень на hh не отдельной меткой; берётся из текста фильтром
      const verdict = screen({ description: text, remoteField, level });

      const stack = stackOf(v.title, text);
      const salaryFrom = (/:(\d[\d  ]*)/.exec(v.salary || c.salary || '') || [])[1];

      if (!verdict.ok) {
        stats.rejected++;
        console.log('  ' + c.id + ' ОТСЕВ (' + stack + '): ' + verdict.why + ' — ' + v.title.slice(0, 55));
        continue;
      }

      // Компания: склейка по norm, а не по новой строке. Найденную приводим к
      // каноническому имени, чтобы «Яндекс» и «ООО Яндекс» не жили отдельно.
      const link = upsertCompany(db, companyRaw, {
        site: 'hh',
        hh_id: v.companyId || (/href="\/employer\/(\d+)"/.exec(page.body) || [])[1] || null,
        hh_url: v.companyId ? 'https://hh.ru/employer/' + v.companyId : null,
        source: 'hh-serp',
      });
      const canon = db.prepare('SELECT name FROM companies WHERE id = ?').get(link.id);

      // Предел на компанию относится к ПАЧКЕ, а не к базе.
      //
      // Вакансия Aston, прошедшая фильтр, — настоящая вакансия, и держать её
      // вне базы нельзя: при следующем сборе она снова попадёт в кандидаты и
      // снова будет прочитана. Пача же нужна для работы: десять вакансий
      // одного работодателя — это десять одинаковых писем, а не десять
      // шансов. Поэтому лишние пишутся в базу и помечаются «вне пачки».
      const perCompany = stats.byCompany.get(link.id) || 0;
      const inBatch = perCompany < MAX_PER_COMPANY;
      if (!inBatch) {
        stats.droppedByCompany++;
      }
      stats.byCompany.set(link.id, perCompany + 1);

      stats.verified++;
      const row = {
        site: 'hh',
        site_id: c.id,
        url: c.url,
        title: v.title,
        company_id: link.id,
        company_raw: canon ? canon.name : companyRaw,
        remote: verdict.remote === 'full' ? 1 : 0,
        no_experience: 1,
        no_education: 1,
        salary_from: salaryFrom ? Number(String(salaryFrom).replace(/\s/g, '')) : null,
        stack: stack,
        experience_floor_months: null,
        description: v.description.slice(0, 8000),
        requirements: v.experience + ' | ' + v.workFormat,
        published: c.published,
      };
      batch.push({ row, stack, remoteKind: verdict.remote, company: row.company_raw, inBatch });
      // Для принятой вакансии screen() не даёт why — он даёт только remote.
      // Раньше здесь печаталось verdict.why, и в логе стояло «(python, undefined)».
      console.log('  ' + c.id + (inBatch ? ' БЕРЁМ' : ' В БАЗУ, вне пачки') + ' (' + stack + ', ' + verdict.remote +
        '): ' + v.title.slice(0, 55) + ' — ' + row.company_raw);
    }

    // --- 3. в базу ---
    // Сортировка одна и та же для записи и для вывода: приоритет стека.
    batch.sort((a, b) => stackRank(a.stack) - stackRank(b.stack));
    if (!args.dryRun) {
      for (const b of batch) insertVacancy(db, b.row);
    }

    const showBatch = batch.filter((b) => b.inBatch).slice(0, args.batch);
    const outside = batch.filter((b) => !b.inBatch);

    console.log('\n=== итог ===');
    console.log('  просмотрено из выдачи: ' + stats.seen);
    console.log('  уже были в базе:        ' + stats.alreadyKnown);
    console.log('  прочитано полностью:   ' + stats.fresh);
    console.log('  прошли фильтр:         ' + stats.verified);
    console.log('  отсеяно фильтром:      ' + stats.rejected);
    console.log('  не прочитано:          ' + stats.unreadable + ' (кандидаты, нужен повтор)');
    console.log('  записано в базу:       ' + (args.dryRun ? 'нет (--dry-run)' : batch.length));
    console.log('  в пачке:               ' + showBatch.length + ', компаний: ' + stats.byCompany.size);
    console.log('  в базу, вне пачки:     ' + outside.length + ' (предел ' + MAX_PER_COMPANY + ' на компанию)');

    if (showBatch.length) {
      console.log('\n=== пачка ' + showBatch.length + ' (приоритет python первым) ===');
      showBatch.forEach((b, i) => {
        console.log('  ' + String(i + 1).padStart(2) + '. [' + b.stack + '] ' + b.row.title);
        console.log('      ' + b.company + '  ' + b.row.url);
      });
      if (outside.length) {
        console.log('\n  ещё ' + outside.length + ' прошедших вакансий в базе, но в пачку не вошли из-за предела по компании:');
        for (const b of outside) console.log('    [' + b.stack + '] ' + b.company + ' — ' + b.row.title.slice(0, 60));
      }
    } else {
      console.log('\n  пачка пуста: подходящих вакансий нет либо не прочитано ни одной страницы.');
      console.log('  Разница важна: смотрите «не прочитано» выше — это повтор, а не вывод «подходящих нет».');
    }
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error('сбой сбора: ' + e.stack);
  process.exitCode = 1;
});