// План создания резюме на hh из локальных версий.
//
// Зачем это отдельный файл. Создание резюме на hh — мастер из шести шагов с
// виртуализированным деревом специальностей и React-инпутами, где синтетический
// клик не срабатывает. Набивать это руками каждый раз — значит набивать руками
// каждый раз ошибаться. Здесь из резюме на диске собирается готовое описание
// того, что вписать в каждое поле, и порядок шагов.
//
// Вход в hh нужен живой сессией. Проверяется так: в document.cookie есть
// domain_sid, в hhrole стоит applicant, а /applicant/resumes отдаёт 200.
// Гостю там 403, поэтому 200 — надёжный признак.
//
// Чего план НЕ делает: не выдумывает месяц начала работы. hh требует месяц и
// год в блоке «Опыт работы», а в локальном резюме честно «2022 — н.в.».
// Публичной даты нет: самый ранний репозиторий — октябрь 2024, на Kwork даты
// не отдаёт. Поэтому план предлагает оставить блок опыта пустым и переносит
// факты про Kwork в «О себе», где дата не нужна.
const fs = require('fs');
const path = require('path');

const resumes = JSON.parse(fs.readFileSync(path.join(__dirname, 'resumes-data.json'), 'utf8'));
const { STACKS } = require('./hh-resume-stack.js');

// Соответствие стеков hh-resume-stack.js и файлов локальных резюме.
const FILE_BY_STACK = {
  python: 'resume-python.html',
  backend: 'resume-backend.html',
  qa: 'resume-qa.html',
  cpp: 'resume-cpp.html',
  gamedev: 'resume-gamedev.html',
  frontend: 'resume-frontend.html',
};

// Навыки для hh: чипы короткие, без длин объяснений. Уровни честные:
// «Продвинутый» не ставим никому — проверяют на собеседовании.
const SKILLS_BY_STACK = {
  python: [
    ['Python', 2], ['Pytest', 2], ['Selenium', 2], ['Allure', 1],
    ['REST API', 2], ['Postman', 2], ['Docker', 1], ['Git', 2],
    ['Linux', 2], ['SQL', 2], ['JSON', 2], ['HTTP', 2],
    ['JavaScript', 1], ['C++', 2], ['Rust', 2],
  ],
  backend: [
    ['Python', 2], ['Rust', 2], ['Actix-web', 2], ['REST API', 2],
    ['PostgreSQL', 1], ['SQL', 2], ['Docker', 1], ['Git', 2],
    ['Linux', 2], ['JSON', 2], ['WebSocket', 2], ['Node.js', 1],
  ],
  qa: [
    ['Selenium', 2], ['Pytest', 2], ['Allure', 2], ['Postman', 2],
    ['TestRail', 1], ['Atlassian Jira', 2], ['Test Design', 1],
    ['Git', 2], ['Docker', 1], ['Linux', 2], ['Python', 2], ['SQL', 2], ['REST API', 2],
  ],
  cpp: [
    ['C++17', 2], ['Rust', 2], ['CMake', 2], ['Win32', 2],
    ['GDI+', 1], ['OpenGL', 2], ['Vulkan', 1], ['GLFW', 2],
    ['Git', 2], ['Linux', 2], ['MSVC', 2], ['MinGW', 2],
  ],
  gamedev: [
    ['C++17', 2], ['Unity', 1], ['C#', 1], ['CMake', 2],
    ['OpenGL', 2], ['Vulkan', 1], ['Rust', 2], ['Git', 2],
    ['Linux', 2], ['MSVC', 2],
  ],
  frontend: [
    ['JavaScript', 2], ['HTML', 2], ['CSS', 2], ['WebSocket', 2],
    ['Node.js', 1], ['Git', 2], ['Selenium', 2], ['Pytest', 2],
    ['Rust', 2], ['Linux', 1],
  ],
};

// Специальность в дереве мастера: hh требует выбрать категорию и профессию.
const SPECIALTY_BY_STACK = {
  python: 'Программист, разработчик',
  backend: 'Программист, разработчик',
  cpp: 'Программист, разработчик',
  gamedev: 'Программист, разработчик',
  frontend: 'Программист, разработчик',
  qa: 'Тестировщик',
};

// Формат работы: под удалённую hh отклики и не ставится, поэтому «удалённо».
const WORK_FORMAT = 'удалённо';

const LIMIT_ABOUT = 900;

function aboutFor(stack) {
  const file = FILE_BY_STACK[stack];
  const found = resumes.find((r) => r.file === file);
  if (!found) return '';
  const text = found.flat.about.replace(/\s+/g, ' ').trim();
  return text.length > LIMIT_ABOUT ? text.slice(0, LIMIT_ABOUT).replace(/\s+\S*$/, '') + '…' : text;
}

const plan = [];
// Правки в уже созданных резюме. Найдено чтением страницы резюме, а не
// предположением: у «Разработчик Python / Backend» формат работы
// «На месте работодателя», а вся очередь — удалённая. Такое резюме hh не
// показывает в удалённой выдаче, и отклик по нему уходит в никуда.
const FIX_EXISTING = {
  backend: [
    {
      what: 'Формат работы',
      now: 'На месте работодателя',
      need: WORK_FORMAT,
      why: 'очередь отбиралась только по удалённым вакансиям; при «на месте работодателя» резюме не попадает в удалённую выдачу',
    },
  ],
};

for (const stack of Object.keys(STACKS)) {
  const s = STACKS[stack];
  const about = aboutFor(stack);
  plan.push({
    stack: stack,
    hhTitle: s.hhTitle,
    alreadyOnHh: !!s.hhResumeReady,
    existingResumeId: s.resumeId,
    fixExisting: FIX_EXISTING[stack] || [],
    sourceFile: FILE_BY_STACK[stack] || null,
    specialtyCategory: 'Информационные технологии',
    specialty: SPECIALTY_BY_STACK[stack],
    about: about,
    aboutLength: about.length,
    workFormat: WORK_FORMAT,
    skills: SKILLS_BY_STACK[stack] || [],
    experience: {
      fill: false,
      why: 'hh требует месяц начала, а в локальном резюме «2022 — н.в.». Публичной даты нет: самый ранний репозиторий — 26.10.2024, Kwork дату не отдаёт. Факты про Kwork перенесены в «О себе».',
    },
    steps: [
      'открыть /applicant/resumes/new',
      'нажать «Укажу профессию» [data-qa="resume-profile-card-select-job"]',
      'вписать должность в [data-qa="resume-profile-position-input"] и нажать Enter, затем выбрать появившийся чип',
      'нажать «Сохранить и продолжить» [data-qa="resume-profile-next-screen"] РЕАЛЬНЫМ кликом',
      'в диалоге раскрыть «Информационные технологии» [data-qa="tree-selector-item tree-selector-item-category-11"] (список виртуализирован, прокрутить [data-qa="tree-selector-container"])',
      'выбрать специальность «' + SPECIALTY_BY_STACK[stack] + '» и нажать [data-qa="category-modal-submit"]',
      'экран common: ФИО и телефон подставлены из профиля, проверить и сохранить',
      'экран educations: оставить отмеченными две позиции УрТК НИЯУ МИФИ',
      'экран keyskills: вписать навыки чипами в [data-qa="chips-trigger-input"] + Enter',
      'экран skill_levels: проставить уровни 1/2/3 в [data-qa="skill-level-N"]',
      'экран experience: нажать «Нет опыта работы»',
      'дойти до конца мастера и записать полученный id резюме в hh-resume-stack.js',
    ],
  });
}

fs.writeFileSync(path.join(__dirname, 'hh-resume-plan.json'), JSON.stringify(plan, null, 1) + '\n', 'utf8');

console.log('стеков описано: ' + plan.length);
for (const p of plan) {
  console.log('  ' + p.stack.padEnd(9) + ' «' + p.hhTitle + '» ' +
    (p.alreadyOnHh ? 'уже создан на hh' : 'НУЖНО СОЗДАТЬ') +
    ' · о себе ' + p.aboutLength + ' симв. · навыков ' + p.skills.length +
    ' · специальность «' + p.specialty + '»');
}
const missingAbout = plan.filter((p) => !p.about).map((p) => p.stack);
if (missingAbout.length) {
  console.log('НЕТ ТЕКСТА «О СЕБЕ»: ' + missingAbout.join(', ') + ' — проверь соответствие стеков и файлов');
  process.exit(1);
}
console.log('\nзаписано: hh-resume-plan.json');
console.log('блок «Опыт работы» остаётся пустым во всех резюме: ' + plan[0].experience.why);

// Правки в уже созданных резюме — выводим отдельно, они не про создание,
// а про исправление, и о них легко забыть.
let fixes = 0;
for (const p of plan) {
  for (const f of p.fixExisting) {
    fixes++;
    console.log('\nПРАВКА резюме «' + p.hhTitle + '» (id ' + (p.existingResumeId || '?') + ')');
    console.log('  ' + f.what + ': сейчас «' + f.now + '», нужно «' + f.need + '»');
    console.log('  почему: ' + f.why);
  }
}
if (!fixes) console.log('правок в созданных резюме не требуется');