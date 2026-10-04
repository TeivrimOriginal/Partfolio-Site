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
      'два года Python: боты, парсеры, REST-сервисы на заказах Kwork',
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
      'агрегирую AniList, Kitsu и Shikimori в одну SQLite-базу ~20 тыс. записей: свой ключ на источник, чекпоинты импорта, докачка с места обрыва',
      'на Kwork делал парсеры сайтов и Telegram-ботов',
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
      'в каталоге три загрузчика внешних API: GraphQL, JSON:API и v1 JSON с разными схемами ошибок',
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
      'SQLite + FTS5 на ~20 тыс. записей: индексы, WAL, пул соединений, полнотекстовый поиск с unicode61',
      'нашёл и починил реальный баг: первичный ключ из целых чисел схлопывал записи разных источников, данные терялись молча',
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
      'Docker + docker-compose с healthcheck и .env.example',
      'CI на GitHub Actions: rustfmt, clippy -D warnings, cargo test, плюс PowerShell-проверка на Windows 5.1 и 7',
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
      '769 автотестов в трёх проектах: 564 + 158 юнит-тестов и 47 UI-тестов Selenium/Pytest/Allure с отчётами и скриншотами падения',
      'ловил плавающий тест и чинил не тест, а причину в коде',
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
      'docs/ARCHITECTURE.md — как устроен каталог и почему именно так, с альтернативами',
      '88 коммитов в движке с нуля, каждый с осмысленным сообщением',
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
      'игровой движок на C++17 с нуля: два бэкенда Vulkan/OpenGL на выбор в рантайме, scene graph, импорт FBX/OBJ через Assimp, CMake, 88 коммитов',
      'редактор на Rust + GLFW/OpenGL со своим immediate-mode UI и 158 юнит-тестов',
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
      'в каталоге контракт API задан типами, а не соглашением: поля не разъедутся молча',
      'нашёл 12 багов при переносе, просто перечитав собственный код, и часть из них про границы контракта',
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
    proof: [
      'PowerShell-скрипт публикации в RuStore: разбор приватного ключа руками, подпись, черновик, загрузка AAB, commit',
      'тест на этот разбор ловил ошибки в ASN.1 до отправки',
    ],
  },
  {
    // Стек, которого у меня нет. Отдельная ветка в письме: честное признание
    // вместо выдуманного опыта.
    id: 'foreign',
    strong: /java|spring|1с|1c|erp|php|golang|unity/i,
    foreign: true,
  },
];

function countHits(re, s) {
  if (!re) return 0;
  const m = s.match(new RegExp(re.source, 'gi'));
  return m ? m.length : 0;
}

/** Собирает письмо под вакансию. title и desc — с карточки hh. */
function composeLetter(title, desc) {
  const t = (title || '').toLowerCase();
  const d = (desc || '').toLowerCase();

  const scored = [];
  let foreign = false;
  for (const g of GROUPS) {
    if (g.foreign) {
      if (countHits(g.strong, t) || countHits(g.strong, d)) foreign = true;
      continue;
    }
    const s = countHits(g.strong, t) * 4 + countHits(g.strong, d) + countHits(g.weak, t) * 3;
    if (s > 0) scored.push({ g, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, 2).filter((x) => x.s >= 2);

  const L = [
    'Здравствуйте! Меня зовут Данила Аринов — Python/C++ разработчик: backend, REST API, автоматизация.',
  ];

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

  if (top.length) {
    L.push('');
    L.push('Что сделаю:');
    const hows = [];
    for (const x of top) for (const v of x.g.how) if (hows.indexOf(v) < 0) hows.push(v);
    for (const v of hows.slice(0, 3)) L.push('— ' + v);
  }

  const proofs = [];
  for (const x of top) for (const v of x.g.proof) if (proofs.indexOf(v) < 0) proofs.push(v);
  if (proofs.length) {
    L.push('');
    L.push('Что уже делал:');
    for (const v of proofs.slice(0, 3)) L.push('— ' + v);
  }

  L.push('');
  L.push(CONTACTS);
  L.push('Готов выполнить тестовое задание.');
  L.push('');
  L.push('Данила Аринов');
  return L.join('\n');
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

  attachLetter(letter) {
    return (
      "(async function(){for(var i=0;i<22;i++){" +
      "var a=Array.prototype.slice.call(document.querySelectorAll('button, a'))" +
      ".filter(function(x){return /Приложить сопроводительное/i.test(x.innerText||'');})[0];" +
      "if(a){a.click();for(var j=0;j<18;j++){" +
      "var ta=document.querySelector('[data-qa=\"vacancy-response-popup-form-letter-input\"]');" +
      "var sb=document.querySelector('[data-qa=\"vacancy-response-letter-submit\"]');" +
      "if(ta&&sb){var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta),'value');" +
      "d.set.call(ta," + JSON.stringify(letter) + ");" +
      "ta.dispatchEvent(new Event('input',{bubbles:true}));sb.click();return 'LETTER_OK';}" +
      "await new Promise(function(r){setTimeout(r,300);});}return 'LETTER_UI_FAIL';}" +
      "await new Promise(function(r){setTimeout(r,300);});}return 'NO_ATTACH';})()"
    );
  },
};

module.exports = { composeLetter, letterTags, browserScripts, CONTACTS, GROUPS };
