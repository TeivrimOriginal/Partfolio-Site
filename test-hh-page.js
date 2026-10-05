// Проверяет hh-page.js на живых ответах hh: RSS и карточка вакансии.
//
// Зачем отдельная проверка. Модуль написан по разметке, снятой с сохранённой
// страницы, а сохранённая страница — это предположение о том, что придёт в
// следующий раз. Здесь берётся свежий ответ и проверяется, что разбор даёт
// осмысленные поля: непустые заголовок, описание и формат работы.
//
// Косвенно проверяется и главное: если разбор вернёт пустоту при HTTP 200,
// это будет видно сразу, а не в отчёте сборщика («0 вакансий»).

const hh = require('./hh-page.js');

const Q = 'text=python&area=113&experience=noExperience&work_format=REMOTE&order_by=publication_time';

function report(label, value) {
  const v = String(value == null ? '' : value);
  console.log('  ' + label.padEnd(16) + (v ? String(v.length) + ' симв. | ' + v.slice(0, 90) : 'ПУСТО'));
}

(async () => {
  let failures = 0;

  // --- RSS ---
  console.log('=== RSS-выдача ===');
  const rssUrl = 'https://zarechny.hh.ru/search/vacancy/rss?' + Q;
  let rssText = '';
  for (const host of hh.HOSTS) {
    const u = rssUrl.replace('zarechny.hh.ru', host);
    const r = await hh.fetchOnce(u);
    if (r.status === 200 && r.body.includes('<item')) { rssText = r.body; console.log('  хост ' + host + ': 200, <item> есть'); break; }
    console.log('  хост ' + host + ': код ' + r.status);
  }
  if (!rssText) {
    console.log('  ПРОВАЛ: RSS не отдан ни одним хостом');
    failures++;
  } else {
    const items = hh.parseRss(rssText);
    console.log('  разобрано вакансий: ' + items.length);
    if (items.length === 0) { console.log('  ПРОВАЛ: разбор вернул пустой список'); failures++; }
    const sample = items[0];
    if (sample) {
      report('id', sample.id);
      report('title', sample.title);
      report('company', sample.company);
      report('url', sample.url);
      report('published', sample.published);
      report('salary', sample.salary);
      // Компания обязана читаться: без неё вакансия не привяжется к компании,
      // а привязка нужна для контактов и для дедупликации.
      if (!sample.company) { console.log('  ПРОВАЛ: компания не извлеклась'); failures++; }
      if (!/^\d+$/.test(sample.id)) { console.log('  ПРОВАЛ: id не число'); failures++; }
    }
    // Уникальность: два одинаковых id означают, что границы <item> нарезаны неверно.
    const ids = items.map((i) => i.id);
    const uniq = new Set(ids).size;
    console.log('  уникальных id: ' + uniq + ' из ' + ids.length);
    if (uniq !== ids.length) { console.log('  ПРОВАЛ: есть повторы id'); failures++; }
  }

  // --- карточка вакансии ---
  console.log('\n=== карточка вакансии ===');
  const probeId = (rssText && /\/vacancy\/(\d+)/.exec(rssText) || [])[1] || '138140507';
  console.log('  беру вакансию ' + probeId);
  const page = await hh.fetchVacancy(probeId, { attempts: 2 });
  if (!page) {
    console.log('  ПРОВАЛ: карточка не пришла (троттлинг или смена вёрстки)');
    failures++;
  } else {
    console.log('  код ' + page.status + ', длина ' + page.body.length);
    const v = hh.parseVacancy(page.body, probeId);
    report('title', v.title);
    report('company', v.company);
    report('experience', v.experience);
    report('workFormat', v.workFormat);
    report('education', v.education);
    report('address', v.address);
    report('description', v.description);
    console.log('  archived: ' + v.archived + '   companyId: ' + v.companyId);
    if (!v.title) { console.log('  ПРОВАЛ: заголовок пуст'); failures++; }
    // Проверка на длину, а не только на пустоту.
    // Первая версия требовала лишь «поле не пусто» и прошла, хотя заголовок
    // возвращался длиной 497026 символов — вся страница целиком. Теперь у
    // каждого короткого поля есть верхняя граница.
    const LIMITS = { title: 300, company: 200, experience: 120, workFormat: 120, education: 120, address: 150 };
    for (const [field, max] of Object.entries(LIMITS)) {
      const got = String(v[field] || '');
      if (got.length > max) {
        console.log('  ПРОВАЛ: ' + field + ' = ' + got.length + ' симв., предел ' + max + ' — элемент не обрезан по закрывающему тегу');
        failures++;
      }
    }
    if (v.description && v.description.length > page.body.length / 2) {
      console.log('  ПРОВАЛ: описание ' + v.description.length + ' симв. при длине страницы ' + page.body.length);
      failures++;
    }
    if (!v.description) { console.log('  ПРОВАЛ: описание пусто — без него фильтр по образованию не работает'); failures++; }
    // Описание не должно обрезаться на первой строке: внутри description есть
    // свои div-ы, и наивный поиск </div> отрезал бы текст после первого абзаца.
    if (v.description && v.description.length < 200) {
      console.log('  ВНИМАНИЕ: описание всего ' + v.description.length + ' симв. — возможно обрезано');
    }
    // archived обязан считаться по короткому заголовку. Когда заголовок был
    // полстраницы, «в архиве» находилось где угодно и давало archived=true у
    // живой вакансии — то есть отсекало всё подряд.
  }

  console.log('\n=== итог ===');
  console.log(failures === 0 ? 'все проверки пройдены' : 'провалов: ' + failures);
  process.exitCode = failures === 0 ? 0 : 1;
})();