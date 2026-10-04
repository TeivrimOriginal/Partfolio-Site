// Генератор сопроводительного письма под конкретную вакансию hh.ru.
//
// Правило: письмо всегда идёт с откликом и всегда собирается заново под вакансию.
// Структура: кто я -> как понял задачу -> что сделаю -> что уже делал -> контакты.
//
// ГЛАВНОЕ ОГРАНИЧЕНИЕ: в блоке «что уже делал» только то, что реально есть.
// Если стека из вакансии (Java, 1С, PHP, Go, Unity) у меня нет — так и написано,
// подменять своим опытом нельзя. Цифры сверены с GitHub: 564 + 158 + 47 = 769
// тестов, ~20 тыс. записей в каталоге, 88 коммитов в движке.
//
// Заголовок вакансии весит вчетверо сильнее описания: в тексте вакансий много
// рекламного шума, где любое объявление содержит «интеграции» и «разработку».
// Слова из `weak` засчитываются только в заголовке, из описания — никогда.

const CONTACTS = 'Код: github.com/TeivrimOriginal · Telegram @Smishnyavko · teivrim@gmail.com';

const GROUPS = [
  {
    id: 'python-backend',
    strong: /python|flask|fastapi|backend|бэкенд|микросервис|endpoint/i,
    weak: /разработчик|api|rest|сервер/i,
    task: 'нужен backend с REST API и интеграцией с внешними сервисами',
    how: [
      'поднять API со схемой БД под реальные запросы, фильтрами и пагинацией',
      'накрыть хендлеры тестами и собрать CI, чтобы регрессии ложились до выкатки',
    ],
    proof: [
      'переписал каталог из 3 публичных API с Node.js на Actix-Web: ~20 тыс. записей, SQLite FTS5, фильтры и пагинация, 564 юнит-теста, CI зелёный',
      'Python на заказах Kwork: Telegram-боты, парсеры сайтов, REST-сервисы',
    ],
    evidence: [
      { file: 'evidence/teivrimsite-readme.txt', quote: 'SQLite FTS5' },
      { file: 'resume-python.html', quote: 'Kwork' },
    ],
  },
  {
    id: 'parsing',
    strong: /парсинг|парсер|scrap|beautifulsoup|выкачк|сбор данных/i,
    weak: /автоматизац/i,
    task: 'нужно стабильно снимать данные с внешних источников и складывать в свою структуру',
    how: [
      'писать парсер с учётом лимитов источника: темп по квоте, Retry-After, докачка с места обрыва',
      'нормализовать сущности в свою схему и отдавать результат через API',
    ],
    proof: [
      'агрегирую AniList, Kitsu и Shikimori в одну SQLite-базу ~20 тыс. записей: ключ на источник поднимает лимит запросов, чекпоинты импорта, каталог пересобирается сам',
      'на Kwork делал парсеры сайтов и Telegram-ботов',
    ],
    evidence: [
      { file: 'evidence/teivrimsite-readme.txt', quote: 'чекпоинт' },
      { file: 'resume-python.html', quote: 'парсер' },
    ],
  },
  {
    id: 'bots',
    strong: /telegram|боты|бот |chat-?бот|webhook/i,
    weak: /интеграц/i,
    task: 'нужен телеграм-бот или интеграция с внешним сервисом',
    how: [
      'взять их API, написать клиента с обработкой ошибок и лимитов, привести ответы к внутренней модели',
      'держать состояние бота в БД, а не в памяти процесса',
    ],
    proof: [
      'Telegram-боты на Python по заказам на Kwork',
      'в каталоге три внешних источника с разными лимитами и форматами ответов сведены к одному JSON API с единым видом ошибок',
    ],
    // «GraphQL, JSON:API и v1 JSON» стояли здесь раньше. В публичном репозитории
    // слов GraphQL и JSON:API нет — есть AniList, Kitsu и Shikimori и описание
    // единого формата ошибок. Проверено: node verify-backend-repo.js
    evidence: [
      { file: 'resume-python.html', quote: 'Telegram' },
      { file: 'evidence/teivrimsite-readme.txt', quote: 'ошибки имеют единый вид' },
    ],
  },
  {
    id: 'db',
    strong: /sqlite|postgres|mysql|sql |бд |базы данных|база данных/i,
    weak: /запрос|индекс/i,
    task: 'нужно работать с БД: схема, запросы, индексы',
    how: [
      'сначала схема и индексы под запросы, потом логика — так узкое место видно на этапе проектирования',
      'закрыть путь запроса тестами на реальных данных',
    ],
    proof: [
      'SQLite + FTS5 на ~20 тыс. записей: индексы, полнотекстовый поиск с unicode61, пул соединений',
      'каталог пересобирается сам по расписанию, ручной запуск защищён токеном',
    ],
    // Сюда раньше стояла история «нашёл и починил баг с первичным ключом из целых
    // чисел, из-за которого записи разных источников схлопывались». Ни в README,
    // ни в резюме её нет, а в письме она читалась как гарантия опыта. Убрана: если
    // историю нечем подтвердить, в отклике её быть не должно.
    evidence: [
      { file: 'evidence/teivrimsite-readme.txt', quote: 'unicode61' },
      { file: 'evidence/teivrimsite-readme.txt', quote: 'пересобирается сам' },
    ],
  },
  {
    id: 'docker-linux',
    strong: /docker|контейнер|linux|devops|инфраструктур/i,
    weak: /выкатк|развёртыв|сервер/i,
    task: 'нужно, чтобы код собирался и запускался предсказуемо',
    how: [
      'Docker-образ с healthcheck и переменными окружения вместо правок в коде',
      'CI, который ломает сборку на ошибках и предупреждениях, а не после релиза',
    ],
    proof: [
      'Docker + docker-compose с healthcheck и .env.example: сервисы поднимаются одной командой',
      'CI на GitHub Actions: rustfmt, clippy -D warnings, cargo test — сборка ломается на ошибках и предупреждениях',
    ],
    // «Плюс PowerShell-проверка на Windows 5.1 и 7» убрано: такой проверки нет
    // ни в одном проекте, а рядом с реальным CI она выглядела как реальная.
    evidence: [
      { file: 'PROJECTFASTAPI/docker-compose.yml', quote: 'healthcheck' },
      { file: 'resume-backend.html', quote: 'clippy' },
    ],
  },
  {
    id: 'tests',
    strong: /автотест|тестиров|qa|quality assurance|pytest|selenium|unit-тест/i,
    weak: /тесты|покрыти|регресс/i,
    task: 'нужно покрыть тестами то, что уже есть, и ловить регрессии',
    how: [
      'тесты на чистой логике без сети и БД — они проходят быстро и детерминированно',
      'отдельно тесты на то, что не видно ни в компиляторе, ни в ответе запроса: PATCH-семантика, лимиты, таймауты',
    ],
    proof: [
      '769 автотестов в трёх проектах: 564 + 158 юнит-тестов и 47 UI-тестов Selenium/Pytest с отчётами Allure',
      'в публичных репозиториях у каждого проекта есть тесты и CI',
    ],
    evidence: [
      { file: 'resume-qa.html', quote: 'Allure' },
      { file: 'resume-backend.html', quote: 'у каждого проекта тесты и CI' },
    ],
  },
  {
    id: 'git-review',
    strong: /git|code review|ревью|документац|версионир/i,
    weak: null,
    task: 'нужна дисциплина в коде: история изменений, ревью, документация',
    how: [
      'атомарные коммиты с объяснением в сообщении, а не «как попало»',
      'архитектурные решения фиксировать письменно, с обоснованием и альтернативами',
    ],
    proof: [
      '88 коммитов в движке с нуля, каждый с осмысленным сообщением',
      'открытый код: 11 активных публичных репозиториев, лицензия MIT',
    ],
    // Ссылка на docs/ARCHITECTURE.md убрана: в дереве репозитория такого файла
    // не нашлось, а упоминание несуществующего файла в письме — это ровно то,
    // что проверяющий откроет первым делом.
    evidence: [
      { file: 'resume-cpp.html', quote: '88 коммитов' },
      { file: 'resume-backend.html', quote: 'лицензия MIT' },
    ],
  },
  {
    id: 'cpp',
    strong: /c\+\+|qt|win32|gdi|opengl|vulkan|glfw|cmake|msvc|mingw/i,
    weak: /десктоп|график/i,
    task: 'нужен C++: интеграция с системой, производительность, десктоп или графика',
    how: [
      'писать код, который собирается и запускается у другого человека одной командой',
      'держать логику отдельно от платформенного слоя — иначе её нечем тестировать',
    ],
    proof: [
      'игровой движок на C++17 с нуля: два бэкенда Vulkan и OpenGL на выбор в рантайме, scene graph, импорт FBX/OBJ через Assimp, CMake, 88 коммитов',
      'редактор на Rust и GLFW со своим immediate-mode UI, 158 юнит-тестов',
    ],
    evidence: [
      { file: 'evidence/teivrim-engine-readme.txt', quote: 'Vulkan' },
      { file: 'resume-cpp.html', quote: '158' },
    ],
  },
  {
    id: 'analysis',
    strong: /аналитик|системн|бизнес-процесс|требован|спецификац/i,
    weak: /описани|контракт|интеграц/i,
    task: 'нужно разобраться в предметной области и зафиксировать требования',
    how: [
      'сначала описать контракты и инварианты, потом код — тогда спор идёт о сути, а не о формате',
      'всё, что нельзя проверить компилятором, фиксировать тестом',
    ],
    proof: [
      'в каталоге контракт ответа задан явно: ошибки единого вида, поля типизированы',
    ],
    // «Нашёл 12 багов при переносе» убрано: числа нет нигде, кроме этого письма.
    // Придуманное «12» выглядит конкретнее настоящих фактов и обесценивает их.
    evidence: [
      { file: 'evidence/teivrimsite-readme.txt', quote: 'ошибки имеют единый вид' },
    ],
  },
  {
    id: 'devops-infra',
    strong: /ansible|мониторинг|observability|лог-файл|централизованн/i,
    weak: /devops|инфраструктур|выкатк/i,
    task: 'нужно автоматизировать сборку, релиз и рутину',
    how: [
      'вынести ручные шаги релиза в скрипт, чтобы релиз не зависел от того, кто его делает',
      'логи, понятные человеку: что упало и на каком шаге',
    ],
    // Раньше здесь стояло «разбор приватного ключа руками… тест на этот разбор
    // ловил ошибки в ASN.1». Ни скрипта test-rustore-signing.ps1, ни разбора
    // ASN.1 на диске нет — поиск по всему D:\SOOBSHESTVA их не находит, а фраза
    // успела разойтись по 13 письмам на hh и по одному на Хабре.
    //
    // Теперь факты берутся из профиля стека hh-resume-stack.js: там каждый
    // пункт подтверждён файлом и проверяется test-proof-sources.js. Своей копии
    // фактов у генератора больше нет — именно из-за двух копий выдумка и
    // разошлась по вакансиям.
    proof: [],
  },
  {
    // Стек, которого у меня нет. Отдельная ветка в письме: честное признание
    // вместо выдуманного опыта.
    //
    // Границы обязательны. Без них «java» совпадает внутри «JavaScript», и
    // вакансия AQA-тестировщика на Python получала письмо «по стеку опыта у
    // меня нет» — ровно то, чего писать нельзя, потому что Python у него есть,
    // а JavaScript в описании упомянут как соседняя технология.
    //
    // И решение принимается только по заголовку. Упоминание Java в списке
    // технологий не делает вакансию Java-вакансией.
    id: 'foreign',
    strong: /(?<![а-яёa-z])(java|spring|php|golang|unity|elixir)(?![а-яёa-z])|(?<![а-яё])(1с|1c|erp)(?![а-яёa-z])/i,
    foreign: true,
  },
];

function countHits(re, s) {
  if (!re) return 0;
  const m = s.match(new RegExp(re.source, 'gi'));
  return m ? m.length : 0;
}

/**
 * Вытаскивает из описания конкретные требования, чтобы письмо было про ИХ
 * задачу, а не про общие слова.
 *
 * Зачем: 11 писем из 20 шорт-листа оказались побайтово одинаковыми — все эти
 * вакансии попали в одну группу требований, и письмо собиралось из одних и тех
 * же пунктов. Рекрутеру, у которого в разных откликах лежит один текст, это
 * видно сразу. Конкретная цитата из описания делает письма разными и заодно
 * показывает, что я прочитал вакансию.
 */
function extractRequirements(desc, limit, title) {
  const max = limit || 2;
  if (!desc) return [];
  const text = desc.replace(/\s+/g, ' ').trim();
  // Режем на предложения по точке, вопросу и переводу строки после регистра.
  const parts = text.split(/(?<=[.!?;:•])\s+|\n+/);
  const wanted = [];
  const re = /нужно|необходимо|требуется|обязан|разрабатыва|пишем|работа с|работать с|знание|опыт|умение|понимание|docker|postgresql|linux|ci|тест|api|rest|asyncio|микросервис|парсер|бот|интеграц|деплой|баз[аы] данных|документ/i;
  const bad = /высшее|среднее|образован|стаж[её]р[а-я]* р?а?з?р?я?т|зп|з\/п|оформлен|бенефит|питани|команд|офис|переезд|договор/i;
  // Заголовок вакансии hh дублирует первое предложение описания. Цитировать
  // «Разработчик Python (FastAPI)» как требование бессмысленно.
  const normTitle = (title || '').toLowerCase().replace(/[^a-zа-яё0-9]+/g, ' ').trim();

  for (const raw of parts) {
    const p = raw.trim().replace(/^[-–—•*\s]+/, '');
    if (p.length < 25 || p.length > 170) continue;
    if (bad.test(p)) continue;
    if (!re.test(p)) continue;
    const norm = p.toLowerCase().replace(/[^a-zа-яё0-9]+/g, ' ').trim();
    if (normTitle && (norm === normTitle || normTitle.indexOf(norm) === 0 || norm.indexOf(normTitle) === 0)) continue;
    if (wanted.some((w) => w.slice(0, 40) === p.slice(0, 40))) continue;
    wanted.push(p.replace(/[.;]+$/, ''));
    if (wanted.length >= max) break;
  }
  return wanted;
}

/**
 * Собирает письмо под вакансию.
 *
 * @param {string} title заголовок вакансии с hh
 * @param {string} desc полный текст описания вакансии с hh
 * @param {string} [company] название компании — чтобы обращаться по имени
 * @param {object} [profile] стековой профиль из hh-resume-stack.js. Без него
 *   письмо начнётся общей строкой про Python и C++, и это будет расходиться с
 *   прикреплённым резюме: у него девять версий под разные вакансии.
 */
function composeLetter(title, desc, company, profile) {
  const t = (title || '').toLowerCase();
  const d = (desc || '').toLowerCase();
  const co = (company || '').trim();

  const scored = [];
  let foreign = false;
  for (const g of GROUPS) {
    if (g.foreign) {
      // Только заголовок: «Java» в списке технологий описания не делает
      // вакансию Java-вакансией.
      if (countHits(g.strong, t)) foreign = true;
      continue;
    }
    const s = countHits(g.strong, t) * 4 + countHits(g.strong, d) + countHits(g.weak, t) * 3;
    if (s > 0) scored.push({ g, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, 2).filter((x) => x.s >= 2);

  const role = (title || '').trim();
  const salutation = co
    ? 'Здравствуйте! Откликаюсь на «' + role + '» в ' + co + '.'
    : 'Здравствуйте! Откликаюсь на «' + role + '».';
  const DEFAULT_INTRO = 'Меня зовут Данила Аринов — Python/C++ разработчик: backend, REST API, автоматизация.';
  const intro = (profile && profile.intro) || DEFAULT_INTRO;
  const L = [
    salutation,
    intro,
  ];

  // Называем прикреплённое резюме. На hh рекрутер видит пару «письмо + резюме»,
  // и явная связка «письмо под это резюме» снимает вопрос, откуда в письме
  // про Selenium, если в заголовке вакансии только про API.
  if (profile && profile.hhTitle) {
    L.push('Резюме, которое прикреплено к отклику: «' + profile.hhTitle + '».');
  }

  // Сначала то, что реально есть в описании. Это главное отличие письма от
  // шаблона: цитата из их вакансии вместо пересказа своего резюме.
  const reqs = extractRequirements(desc, 2, title);
  if (reqs.length) {
    L.push('');
    L.push('Из описания выделил для себя:');
    for (const r of reqs) L.push('— «' + r + '»');
  }

  if (foreign) {
    L.push('');
    L.push('По стеку из вакансии опыта у меня пока нет, и врать про это не буду. Возьму так же, как переносил систему между стеками: сначала разберу чужой код и контракты, потом принесу небольшие проверяемые куски.');
  } else if (top.length) {
    L.push('');
    L.push('По вакансии понял задачу так: ' + top[0].g.task + '.');
  } else {
    L.push('');
    L.push('Конкретную задачу из описания вытащил плохо — допишу её точнее после короткого уточняющего вопроса, чтобы не гадать.');
  }

  const hows = [];
  if (top.length) {
    L.push('');
    L.push('Что сделаю:');
    for (const x of top) for (const v of x.g.how) if (hows.indexOf(v) < 0) hows.push(v);
    for (const v of hows.slice(0, 3)) L.push('— ' + v);
  }

  const proofs = [];
  // Сначала доказательства из прикреплённого резюме: именно их рекрутер видит
  // рядом с письмом. Потом — из групп требований вакансии, если задача уже там
  // попала в другую ветку. Так письмо и про вакансию, и про то, что реально
  // прикреплено.
  const candidates = [];
  if (profile && profile.proof) for (const v of profile.proof) candidates.push(v);
  for (const x of top) for (const v of x.g.proof) candidates.push(v);
  // Повтор проверяется и против блока «Что сделаю»: «Docker-образ с healthcheck»
  // в плане и «Docker + docker-compose с healthcheck» в достижениях — это один
  // факт, и писать его дважды нельзя.
  const said = hows.slice(0, 3);
  for (const v of candidates) {
    if (proofs.length >= 4) break;
    // Внутри блока фактов — жёсткое правило по технологиям: два пункта про один
    // инструмент это дубль, даже если слова разные.
    if (proofs.some((p) => p === v || sameFactLoose(p, v))) continue;
    // Против блока «Что сделаю» — только строгое правило: план про healthcheck и
    // сделанное про compose на шесть сервисов совпадают словами, но это разные
    // вещи, и второе как раз и есть опыт.
    if (said.some((p) => p === v || sameFact(p, v))) continue;
    proofs.push(v);
  }
  if (proofs.length) {
    L.push('');
    L.push('Что уже делал:');
    for (const v of proofs) L.push('— ' + v);
  }

  L.push('');
  L.push(CONTACTS);
  L.push('Готов выполнить тестовое задание.');
  L.push('');
  L.push('Данила Аринов');

  // Бюджет длины. Письмо длиннее 1500 символов hh обрезает, и хвост с
  // подписью уезжает за край — отклик уходит без подписи и без «готов выполнить
  // тестовое». Случилось это с вакансией 137280834: 1513 символов.
  //
  // Решение — убирать наименее важное, а не обрезать текст: сначала последний
  // пункт «Что уже делал», потом последний пункт «Что сделаю». Подпись, контакты
  // и обещание тестового остаются в любом случае.
  const LIMIT = 1500;
  let out = L.join('\n');
  const trimTail = (header) => {
    for (let guard = 0; guard < 8 && out.length > LIMIT; guard++) {
      const hi = out.indexOf(header + '\n');
      if (hi < 0) break;
      // Последний пункт блока — самая длинная строка под ним.
      const blockStart = hi + header.length + 1;
      const nextBlock = out.indexOf('\n\n', blockStart);
      const blockEnd = nextBlock < 0 ? out.length : nextBlock;
      const block = out.slice(blockStart, blockEnd).split('\n').filter(Boolean);
      if (block.length <= 1) break;
      block.pop();
      out = out.slice(0, hi) + header + (block.length ? '\n' + block.join('\n') : '') + (nextBlock < 0 ? '' : out.slice(blockEnd));
    }
    return out;
  };
  out = trimTail('Что уже делал:');
  out = trimTail('Что сделаю:');
  if (out.length > LIMIT) {
    // Не помогло сокращением пунктов — убираем цитату из описания: это полезно,
    // но письмо должно дойти целиком.
    const qi = out.indexOf('Из описания выделил для себя:\n');
    if (qi >= 0) {
      const qe = out.indexOf('\n\n', qi);
      if (qe > 0) out = out.slice(0, qi) + out.slice(qe + 2);
    }
  }
  if (out.length > LIMIT) {
    throw new Error('письмо не уложилось в ' + LIMIT + ' символов даже после сокращений: ' + out.length + '. Разберись, а не отправляй обрезанным.');
  }
  return out;
}

/** Теги совпадений — для отчёта, чтобы видеть, что письмо не поедет на всё подряд. */
function letterTags(title, desc) {
  const t = (title || '').toLowerCase();
  const d = (desc || '').toLowerCase();
  const out = [];
  let foreign = false;
  for (const g of GROUPS) {
    if (g.foreign) {
      if (countHits(g.strong, t) || countHits(g.strong, d)) foreign = true;
      continue;
    }
    const s = countHits(g.strong, t) * 4 + countHits(g.strong, d) + countHits(g.weak, t) * 3;
    if (s >= 2) out.push(g.id + ':' + s);
  }
  if (foreign) out.push('foreign');
  return out;
}

// Скрипты для браузера. Вынесены отдельно, чтобы apply-цикл не собирал строки
// на каждый отклик заново.
const browserScripts = {
  /** Текст вакансии без навигации: fetch + DOMParser. */
  fetchVacancy(id) {
    return (
      "(async function(){" +
      "var r = await fetch('/vacancy/" + id + "', {credentials:'include'});" +
      "if(!r.ok) return JSON.stringify({err:'HTTP '+r.status});" +
      "var doc = new DOMParser().parseFromString(await r.text(),'text/html');" +
      "var ti=doc.querySelector('[data-qa=\"vacancy-title\"]');" +
      "var co=doc.querySelector('[data-qa=\"vacancy-company-name\"]');" +
      "var de=doc.querySelector('[data-qa=\"vacancy-description\"]');" +
      "var ex=doc.querySelector('[data-qa=\"vacancy-experience\"]');" +
      "return JSON.stringify({title: ti?ti.innerText.trim().slice(0,70):''," +
      "company: co?co.innerText.trim().slice(0,40):''," +
      "exp: ex?ex.innerText.replace(/\\s+/g,' ').trim().slice(0,26):''," +
      "remote: /Формат работы: удалённо|Можно удалённо/i.test(doc.body.innerText)," +
      "desc: de?de.innerText.replace(/\\s+/g,' ').slice(0,1800):''});" +
      "})()"
    );
  },

  checkFilters:
    "(async function(){for(var i=0;i<32;i++){var t=document.body?document.body.innerText.replace(/\\s+/g,' '):'';" +
    "if(t.length>400)return JSON.stringify({noExp:/Опыт работы: не требуется/i.test(t)," +
    "remote:/Формат работы: удалённо|Можно удалённо/i.test(t),applied:/Вы откликнулись/i.test(t)," +
    "title:(document.querySelector('h1')||{}).innerText||''," +
    "hasBtn:!!document.querySelector('[data-qa=\"vacancy-response-link-top\"]')});" +
    "await new Promise(function(r){setTimeout(r,400);});}return JSON.stringify({timeout:true});})()",

  clickApply:
    "(function(){var b=document.querySelector('[data-qa=\"vacancy-response-link-top\"]');" +
    "if(b){b.click();return 'ok';}return 'n';})()",

  submit:
    "(async function(){for(var i=0;i<20;i++){var b=document.querySelector('[data-qa=\"vacancy-response-submit-popup\"]');" +
    "if(b){if(b.disabled)return 'DISABLED';b.click();" +
    "for(var j=0;j<12;j++){var t=document.body.innerText.replace(/\\s+/g,' ');" +
    "if(/Вы откликнулись/i.test(t))return 'SENT';" +
    "if(/Ответьте на вопросы|необходимо ответить/i.test(t))return 'QUESTIONNAIRE';" +
    "if(/Пройдите капчу|введите текст с картинки/i.test(t))return 'CAPTCHA';" +
    "await new Promise(function(r){setTimeout(r,400);});}return 'PENDING';}" +
    "await new Promise(function(r){setTimeout(r,400);});}return 'NO_SUBMIT';})()",

  // ВАЖНО. Раньше здесь стояло `sb.click(); return 'LETTER_OK'` — и этого
  // достаточно не было. Так я отчитывался об успехе на пустых откликах: в чате
  // Aston по вакансии 136983022 висело «Отклик на вакансию — Без сопроводительного
  // письма», то есть письмо не прикрепилось, хотя код сказал, что отправил.
  //
  // Теперь результат неоднозначный и проверяемый:
  //   LETTER_SENT     — поле приняло текст и сабмит отработал без ошибки
  //   LETTER_UNVERIFIED — текст в поле не оказался равным тому, что мы вписали
  //   LETTER_NO_FIELD  — поля ввода не появились
  // Возвращать 'OK' при отсутствии проверки больше нельзя.
  attachLetter(letter) {
    return (
      "(async function(){for(var i=0;i<22;i++){" +
      "var a=Array.prototype.slice.call(document.querySelectorAll('button, a'))" +
      ".filter(function(x){return /Приложить сопроводительное/i.test(x.innerText||'');})[0];" +
      "if(a){a.click();for(var j=0;j<18;j++){" +
      "var ta=document.querySelector('[data-qa=\"vacancy-response-popup-form-letter-input\"]');" +
      "var sb=document.querySelector('[data-qa=\"vacancy-response-letter-submit\"]');" +
      "if(ta&&sb){" +
      "var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta),'value');" +
      "d.set.call(ta," + JSON.stringify(letter) + ");" +
      "ta.dispatchEvent(new Event('input',{bubbles:true}));" +
      "ta.dispatchEvent(new Event('change',{bubbles:true}));" +
      // Читаем обратно. Если React не принял значение, здесь будет не то же самое,
      // и мы не будем нажимать отправку — сначала чинить, потом отправлять.
      "var back=ta.value;" +
      "if(back!==ta.defaultValue&&back.length>0&&back.indexOf('Данила Аринов')<0){return 'LETTER_UNVERIFIED:'+back.length;}" +
      "if(back.length<"+ JSON.stringify(String(letter.length)) +"*0.5){return 'LETTER_UNVERIFIED:len'+back.length+':'+back.slice(0,40);}" +
      "sb.click();" +
      "for(var k=0;k<12;k++){await new Promise(function(r){setTimeout(r,400);});" +
      "if(!document.querySelector('[data-qa=\"vacancy-response-letter-submit\"]'))return 'LETTER_SENT';}" +
      "return 'LETTER_SENT_STUCK';}" +
      "await new Promise(function(r){setTimeout(r,300);});}return 'LETTER_NO_FIELD';}" +
      "await new Promise(function(r){setTimeout(r,300);});}return 'LETTER_NO_ATTACH';})()"
    );
  },
};

// Похожие формулировки одного факта. Письмо не должно содержать «769
// автотестов» дважды: одно предложение из резюме и одно из группы требований
// говорят о том же самом разными словами, и это выглядит как невнимательность.
// Сравнение по множеству значимых слов: если половина слов совпала, строка
// считается тем же фактом.
const STOP = new Set(['и', 'в', 'на', 'с', 'по', 'для', 'не', 'что', 'как', 'из', 'до', 'за', 'при', 'под', 'к', 'а', 'то', 'же', 'у', 'о', 'или']);

function words(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-zа-яё0-9+]+/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
  );
}

// Технологический след: два пункта про один и тот же инструмент — это один и тот
// же факт, даже когда слова разные. Без этого в письма попадало:
//
//   — Docker и docker-compose на шесть сервисов: healthcheck у БД и брокера…
//   — Docker + docker-compose с healthcheck и .env.example: сервисы поднимаются
//
// Разница только в формулировке, а читатель видит один пункт, написанный дважды.
// Порог 50% по общим словам не срабатывал: короткий пункт длиннее по числу
// слов, и получалось 0.4 вместо 0.5. Поэтому отдельно считаем общие
// технологические токены — латиница, а не русские слова.
const LATIN_TOKEN = /^[a-z_][a-z0-9_.\-+]*$/;

function techTokens(sentence) {
  // words() возвращает Set, а не массив: filter здесь неприменим.
  const out = new Set();
  for (const w of words(sentence)) if (LATIN_TOKEN.test(w) && w.length >= 4) out.add(w);
  return out;
}

// Строгий вариант: совпадение по обычным словам. Применяется между блоками
// «Что сделаю» и «Что уже делал», где один пункт про план, а другой про
// сделанное, — это разные вещи, и путать их нельзя.
function sameFact(a, b) {
  const A = words(a);
  const B = words(b);
  if (A.size < 3 || B.size < 3) return false;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size) >= 0.5;
}

// Жадный вариант: добавляет совпадение по технологическим токенам. Применяется
// только внутри блока фактов, где два пункта про один инструмент действительно
// дубль. Между блоками он даёт ошибку: план «Docker-образ с healthcheck» и
// сделанное «compose на шесть сервисов с healthcheck и именованными томами» —
// не одно и то же, а жадное правило выкидывало из письма единственный реальный
// опыт по Docker.
function sameFactLoose(a, b) {
  if (sameFact(a, b)) return true;
  const TA = techTokens(a);
  const TB = techTokens(b);
  if (TA.size < 2 || TB.size < 2) return false;
  let shared = 0;
  for (const w of TB) if (TA.has(w)) shared++;
  return shared >= 2 && shared / TB.size >= 0.5;
}

module.exports = { composeLetter, letterTags, extractRequirements, browserScripts, CONTACTS, GROUPS, sameFact, sameFactLoose };
