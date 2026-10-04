// Какое резюме прикреплять к отклику и о каком стеке писать в письме.
//
// Зачем это. На hh к отклику прикрепляется одно резюме, и рекрутер видит пару
// «вакансия + письмо». Если письмо начинается «Python/C++ разработчик», а
// прикреплено резюме «Разработчик C++» — это либо шаблон, либо ошибка. Раньше
// письма начинались одной и той же строкой независимо от резюме.
//
// У него девять локальных версий резюме (resume-python.html, resume-qa.html и
// так далее, разобраны extract-resumes.js в resumes-data.json). Здесь они
// превращены в правила: стек, заголовок резюме для письма и три доказательства
// из конкретных проектов.
//
// Все цифры в proof — из его собственных проектов и сверены с резюме:
// 564 + 158 + 47 = 769 автотестов, ~20 тыс. записей в каталоге, 88 коммитов
// в движке, 140+ тестов в редакторе, 15+ инструментов в TPaint.
//
// Поле resumeId — это id резюме на hh. Он же попадает в отклик: отклик без
// выбранного резюме на hh не отправляется.

// Поле publicUrl — публичная ссылка на резюме на GitHub Pages.
//
// Зачем проверять: до сих пор в репозитории отслеживались только
// resume.html и resume-en.html, поэтому Pages отдавал 404 на всё остальное, и
// ссылка на резюме под конкретный стек была нерабочей. Отклик на Хабре
// требует ссылку на резюме, так что без этих URL отклик не собрать.
// Проверка: node verify-resume-links.js

const PUBLIC = 'https://teivrimoriginal.github.io/Partfolio-Site/';

// Доказательства берём из локальных резюме, а не выдумываем: каждый пункт
// это то, что уже лежит в resumes-data.json в поле «проекты» этого стека.
const STACKS = {
  python: {
    label: 'Junior Python-разработчик',
    file: 'resume-python.html',
    publicUrl: PUBLIC + 'resume-python.html',
    hhTitle: 'Junior Python-разработчик',
    resumeId: null,
    hhResumeReady: false,
    intro: 'Меня зовут Данила Аринов — Junior Python-разработчик: автоматизация, интеграции, тестирование.',
    proof: [
      'Python на заказах Kwork: Telegram-боты, парсеры сайтов, REST-интеграции по ТЗ заказчиков',
      'переписал каталог из 3 публичных API с Node.js на Actix-Web: ~20 тыс. записей, SQLite FTS5, фильтры и пагинация',
      '769 автотестов в трёх проектах, CI на каждом пуше',
    ],
    evidence: [
      { file: 'resume-python.html', quote: 'Kwork' },
      { file: 'evidence/teivrimsite-readme.txt', quote: 'AniList, Kitsu и Shikimori' },
      { file: 'resume-python.html', quote: '769' },
    ],
  },
  backend: {
    label: 'Junior Backend-разработчик',
    file: 'resume-backend.html',
    publicUrl: PUBLIC + 'resume-backend.html',
    hhTitle: 'Junior Backend-разработчик',
    resumeId: 'bf37e31cff112962a90039ed1f6d625a44436d',
    hhResumeReady: true,
    intro: 'Меня зовут Данила Аринов — Junior Backend-разработчик: Python и Rust, REST API, реляционные данные.',
    proof: [
      'переписал каталог из 3 публичных API с Node.js на Actix-Web: ~20 тыс. записей, SQLite FTS5, фильтры и пагинация, 564 юнит-теста',
      'три внешних источника — AniList, Kitsu и Shikimori — с разными лимитами сведены в один JSON API с единым видом ошибок; лимит AniList поднимается ключом с 30 до 90 запросов в минуту',
      'Docker + docker-compose с healthcheck и зависимостью по готовности сервисов, CI на GitHub Actions: rustfmt, clippy -D warnings, cargo test',
    ],
    evidence: [
      { file: 'evidence/teivrimsite-readme.txt', quote: 'SQLite FTS5' },
      // Раньше здесь стояли «GraphQL, JSON:API и v1 JSON». В репозитории есть
      // AniList, Kitsu и Shikimori, но слов GraphQL и JSON:API там нет — названия
      // протоколов появились сами. Проверено: node verify-backend-repo.js
      { file: 'evidence/teivrimsite-readme.txt', quote: 'поднимает лимит AniList с 30 до 90' },
      { file: 'PROJECTFASTAPI/docker-compose.yml', quote: 'healthcheck' },
    ],
  },
  qa: {
    label: 'Junior QA-инженер',
    file: 'resume-qa.html',
    publicUrl: PUBLIC + 'resume-qa.html',
    hhTitle: 'Junior QA-инженер',
    resumeId: null,
    hhResumeReady: false,
    intro: 'Меня зовут Данила Аринов — Junior QA-инженер: автотесты UI, тест-дизайн, CI.',
    proof: [
      '47 UI-автотестов на Selenium 4 и Pytest с отчётами Allure, включая негативные сценарии и формы',
      '769 автотестов суммарно в трёх проектах: 564 и 158 юнит-тестов плюс UI-тесты',
      'тест-кейсы по чек-листу с привязкой к требованию; чинил не тест, а причину в коде',
    ],
    evidence: [
      { file: 'resume-qa.html', quote: 'Selenium' },
      { file: 'resume-qa.html', quote: '769' },
      { file: 'resume-qa.html', quote: 'тест-кейс' },
    ],
  },
  cpp: {
    label: 'Junior C++-разработчик',
    file: 'resume-cpp.html',
    publicUrl: PUBLIC + 'resume-cpp.html',
    hhTitle: 'Разработчик C++',
    resumeId: '5a7a0ca7ff10971d1b0039ed1f324c65625969',
    hhResumeReady: true,
    intro: 'Меня зовут Данила Аринов — Junior C++-разработчик: движки, графика, прикладные приложения.',
    proof: [
      'игровой движок на C++17 с нуля: два графических бэкенда Vulkan и OpenGL на выбор в рантайме, scene graph, импорт FBX/OBJ через Assimp, 88 коммитов',
      'редактор на Rust и GLFW со своим immediate-mode UI, 158 юнит-тестов',
      'Win32 и GDI+ приложение, собирается MinGW/MSVC одной командой',
    ],
    evidence: [
      // Названия бэкендов в письмах появились раньше, чем в резюме, поэтому
      // подтверждены по публичному репозиторию: node verify-github-facts.js
      { file: 'evidence/teivrim-engine-readme.txt', quote: 'Vulkan' },
      { file: 'resume-cpp.html', quote: '158' },
      { file: 'resume-cpp.html', quote: 'GDI+' },
    ],
  },
  gamedev: {
    label: 'Разработчик игр',
    file: 'resume-gamedev.html',
    publicUrl: PUBLIC + 'resume-gamedev.html',
    hhTitle: 'Разработчик игр',
    resumeId: '5a7a0ca7ff10971d1b0039ed1f324c65625969',
    hhResumeReady: true,
    intro: 'Меня зовут Данила Аринов — разработчик игр на C++ и Rust: движок, рендер, редакторы.',
    proof: [
      'движок с нуля на C++17: выбор бэкенда рендера в рантайме, scene graph, Assimp для FBX и OBJ, 88 коммитов',
      'редактор изображений на Rust со своим immediate-mode UI: 15+ инструментов, 140+ автотестов',
      'живой опыт в команде на Unity: геймдизайн и прототипирование за выходные',
    ],
    evidence: [
      { file: 'evidence/teivrim-engine-readme.txt', quote: 'scene graph' },
      { file: 'resume-gamedev.html', quote: 'immediate-mode' },
      { file: 'resume-gamedev.html', quote: 'Unity' },
    ],
  },
  frontend: {
    label: 'Junior Frontend-разработчик',
    file: 'resume-frontend.html',
    publicUrl: PUBLIC + 'resume-frontend.html',
    hhTitle: 'Junior Frontend-разработчик',
    resumeId: null,
    hhResumeReady: false,
    intro: 'Меня зовут Данила Аринов — Junior Frontend-разработчик: JavaScript, интерфейсы, real-time.',
    proof: [
      'социальный мессенджер на хакатоне: WebSocket на socket.io, авторизация по паролю с хешированием, загрузка файлов',
      'портфолио-сайт на JavaScript и HTML5 без сборщика, собственный drag-and-drop на immediate-mode UI',
      '47 UI-автотестов Selenium и Pytest — интерфейс проверяется автоматически',
    ],
    evidence: [
      { file: 'resume-frontend.html', quote: 'socket.io' },
      { file: 'resume-frontend.html', quote: 'drag-and-drop' },
      { file: 'resume-frontend.html', quote: '47' },
    ],
  },
  devops: {
    // Отдельный стек, потому что три из четырёх вакансий на Хабре — DevOps.
    // Без него они уезжали в qa по слову «тестирование» в описании и получали
    // чужое резюме.
    //
    // Отдельный файл появился, потому что три из четырёх вакансий на Хабре и 14 на
    // hh — DevOps, а подставлять backend-резюме было нельзя: письмо называет
    // «Инженер DevOps», а в ссылке стоял заголовок «Junior Backend-разработчик».
    // Каждый пункт файла ссылается на проверяемый источник, перечень — в шапке
    // resume-devops.html.
    label: 'Инженер DevOps',
    file: 'resume-devops.html',
    publicUrl: PUBLIC + 'resume-devops.html',
    hhTitle: 'Инженер DevOps',
    resumeId: null,
    hhResumeReady: false,
    intro: 'Меня зовут Данила Аринов — Junior инженер DevOps: Linux, Docker, CI, сборка и выкатка релиза.',
    // Каждый пункт обязан быть подтверждён файлом: см. evidence ниже и
    // test-proof-sources.js. Раньше здесь стояло «разбор приватного ключа в
    // ASN.1 вручную и тест test-rustore-signing.ps1, который ловил ошибки до
    // отправки» — такого скрипта на диске нет, а фраза успела разойтись по
    // письмам. Проверяется простым поиском по D:\SOOBSHESTVA.
    proof: [
      'Docker и docker-compose на шесть сервисов: healthcheck у БД и брокера, API и воркеры стартуют после готовности через depends_on, данные в именованных томах',
      'скрипт сборки релиза на PowerShell: подпись ключом, AAB и APK, SHA-256 каждого артефакта, версии рядом с ними — пересборка даёт тот же результат',
      'CI на GitHub Actions: rustfmt, clippy с -D warnings, cargo test — сборка ломается на ошибках и предупреждениях',
    ],
    // evidence[i] подтверждает proof[i]: файл обязан существовать, а quote —
    // в нём присутствовать. Если утверждение нельзя подтвердить файлом, оно не
    // попадает в письма.
    evidence: [
      { file: 'PROJECTFASTAPI/docker-compose.yml', quote: 'pg_isready' },
      { file: 'D:/SOOBSHESTVA/AUTOMATIC/YandexGame/rustore/build-apk.ps1', quote: 'Get-FileHash' },
      { file: 'resume-devops.html', quote: 'clippy' },
    ],
  },
};

// Порядок важен: более узкие стеки проверяются раньше широких. «QA-инженер»
// содержит слово «инженер», а «Разработчик игр» — «разработчик», поэтому
// порядок по широте даёт правильный выбор без исключений.
// ВНИМАНИЕ, здесь уже была ошибка. Слово «бот» без границ совпадает внутри
// «разра**бот**чик», а «разработчик» есть в каждой второй вакансии. Из-за этого
// все вакансии разработчиков уезжали в стек python, и к QA/C++/Frontend
// вакансиям прикреплялось чужое резюме. Границы обязательны, и такие же уже
// стоят в hh-target.js — здесь они были забыты.
const WORD = {
  qa: /(?<![а-яёa-z])(qa|sdet)(?![а-яёa-z])|тестиров|тест-?инженер|автотест|quality assurance|инженер по тестированию/i,
  frontend: /(?<![а-яёa-z])(frontend|javascript|react|vue|angular)(?![а-яёa-z])|фронтенд|верстальщик/i,
  gamedev: /(?<![а-яёa-z])(game|gamedev|unity|unreal|godot)(?![а-яёa-z])|(?<![а-яё])игр(?![а-яё])|движок/i,
  cpp: /(?<![a-z])c\+\+(?![a-z])|(?<![а-яёa-z])(qt|win32|gdi|opengl|vulkan|glfw|msvc|mingw)(?![а-яёa-z])|десктоп/i,
  python: /(?<![а-яёa-z])(python|flask|fastapi|django)(?![а-яёa-z])|парсер|парсинг|(?<![а-яёa-z])бот(?![а-яёa-z])|автоматизац|скрипт/i,
  backend: /(?<![а-яёa-z])(backend|api|rest)(?![а-яёa-z])|бэкенд|микросервис|интеграц|сервер/i,
};

const RULES = [
  { stack: 'qa', strong: WORD.qa },
  { stack: 'frontend', strong: WORD.frontend },
  { stack: 'gamedev', strong: WORD.gamedev },
  { stack: 'cpp', strong: WORD.cpp },
  // DevOps проверяется до python: в описании почти всегда есть «тестирование»
  // и «мониторинг», и без этого правила вакансия DevOps уходила в qa.
  { stack: 'devops', strong: /(?<![а-яёa-z])(devops|docker|kubernetes|ansible|terraform)(?![а-яёa-z])|ci[ /]?cd|инфраструктур|системный инженер|мониторинг/i },
  { stack: 'python', strong: WORD.python },
  { stack: 'backend', strong: WORD.backend },
];

const DEFAULT_STACK = 'python';

/**
 * Определяет стек вакансии: сначала заголовок (он весит вчетверо), потом описание.
 * Возвращает стек и причину — чтобы по логу было видно, почему выбрано именно
 * это резюме, а не соседнее.
 *
 * При равном счёте побеждает то, что стоит в заголовке раньше. В «Backend
 * Engineer (Python)» оба слова есть, оба весят одинаково, но роль — это backend,
 * а Python здесь инструмент. Без этого правила такие вакансии уходили в стек
 * python и прикреплялось не то резюме.
 */
function stackFor(title, desc) {
  const t = (title || '').toLowerCase();
  const d = (desc || '').toLowerCase();
  const scored = [];
  for (const r of RULES) {
    const hits = t.match(new RegExp(r.strong.source, 'gi')) || [];
    const dHits = d.match(new RegExp(r.strong.source, 'gi')) || [];
    if (!hits.length && !dHits.length) continue;
    const first = t.search(new RegExp(r.strong.source, 'i'));
    scored.push({
      stack: r.stack,
      s: hits.length * 4 + dHits.length,
      first: first < 0 ? 999 : first,
    });
  }
  if (!scored.length) return { stack: DEFAULT_STACK, why: 'в заголовке нет ключевых слов, беру основное позиционирование' };
  scored.sort((a, b) => b.s - a.s || a.first - b.first);
  return {
    stack: scored[0].stack,
    why: 'совпадений в заголовке: ' + scored[0].s + ', первое на позиции ' + scored[0].first,
  };
}

/** Профиль для письма: строка «кто я» и доказательства из этого стека. */
function profileFor(stack) {
  const s = STACKS[stack] || STACKS[DEFAULT_STACK];
  return {
    stack: s === STACKS[stack] ? stack : DEFAULT_STACK,
    label: s.label,
    intro: s.intro,
    proof: s.proof,
    hhTitle: s.hhTitle,
    resumeId: s.resumeId,
    hhResumeReady: s.hhResumeReady,
  };
}

/** Итог по всем стекам: сколько вакансий под какое резюме. */
function planFor(vacancies) {
  const plan = {};
  for (const v of vacancies) {
    const r = stackFor(v.title, v.desc || '');
    if (!plan[r.stack]) plan[r.stack] = { count: 0, ids: [], why: r.why };
    plan[r.stack].count++;
    plan[r.stack].ids.push(v.id);
  }
  return plan;
}

module.exports = { STACKS, RULES, DEFAULT_STACK, stackFor, profileFor, planFor };