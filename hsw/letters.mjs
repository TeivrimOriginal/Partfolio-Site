// Генератор писем. Пишет черновик — отправляет человек.
//
// Структура задана ТЗ и соблюдается буквально:
//   1. Два предложения о том, что у меня есть уже сейчас и чем это закрывает
//      требования вакансии. Не «хочу учиться», а конкретный проект с цифрами.
//   2. Что под требования я подхожу и почему условия подходят (удалёнка, формат).
//   3. Контакты.
//
// Правило, которое держит качество: каждое утверждение о себе должно иметь
// опору в резюме. Отдельная проверка `checkClaims` ловит обещания, которых
// в резюме нет, — именно они ломают доверие на первом же созвоне.

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Опора для первых двух предложений: релевантный проект под стек вакансии.
 * Если проекта нет — письмо всё равно пишется, но честно, без выдуманного опыта.
 */
function evidenceFor(vacancy, stack, profile) {
  const text = `${vacancy.title} ${vacancy.description || ''}`.toLowerCase();
  const hits = [];

  for (const p of profile.projects) {
    let weight = 0;
    for (const kw of p.keywords) if (text.includes(kw.toLowerCase())) weight += 1;
    if (weight) hits.push({ p, weight });
  }
  hits.sort((a, b) => b.weight - a.weight);

  if (hits.length) {
    const { p } = hits[0];
    return { kind: 'project', name: p.name, line: p.line, link: p.link || '' };
  }
  if (stack === 'QA' || /тест|qa/i.test(vacancy.title)) {
    return { kind: 'project', name: 'practice-automation-tests', line: '47 UI-автотестов на Selenium и Pytest с отчётами Allure, запуск одной командой', link: 'https://github.com/TeivrimOriginal/practice-automation-tests' };
  }
  return { kind: 'freelance', name: 'Kwork', line: 'заказы на Python: Telegram-боты, парсеры, REST-интеграции по ТЗ заказчиков', link: 'https://kwork.ru/user/teivrim' };
}

/** Профиль: то, что действительно есть. Ничего сверх этого списка не обещаем. */
export const PROFILE = {
  name: 'Данила Аринов',
  title: 'Junior Python-разработчик',
  contacts: {
    phone: '+7 901 431-82-98',
    email: 'teivrim@gmail.com',
    telegram: '@Smishnyavko',
    github: 'https://github.com/TeivrimOriginal',
    hh: 'https://hh.ru/profile',
    portfolio: 'https://teivrimoriginal.github.io/Partfolio-Site/',
  },
  facts: [
    'Python с 2022, коммерческие заказы на Kwork: Telegram-боты, парсеры, REST-интеграции по ТЗ заказчиков.',
    'TaskHub API: асинхронный backend на FastAPI с PostgreSQL — 5 986 строк Python в 72 файлах, 43 эндпоинта, три слоя api → services → repositories.',
    'Вокруг TaskHub: 318 автотестов (pytest, 90,4% покрытия), ruff, mypy --strict, Docker-образ и docker compose для всего стека.',
    'Авторизация в TaskHub: OAuth2 password flow, JWT access + refresh с ротацией токенов и семейств, bcrypt, роли user / moderator / admin.',
    'anime-sync-api: FastAPI + SQLAlchemy 2.0 async + asyncpg, полнотекстовый поиск на tsvector с индексом GIN, синхронизация с AniList и Jikan.',
    'Anime DB на Rust (Actix-Web): агрегация трёх публиких API, ~20 тыс. записей, 564 юнит-теста.',
    '769 автотестов суммарно по всем проектам, CI на каждом пуше.',
  ],
  projects: [
    { name: 'TaskHub API', keywords: ['fastapi', 'python', 'api', 'backend', 'postgres', 'sql', 'docker', 'celery', 'redis', 'jwt', 'async', 'orm'],
      line: 'TaskHub API — асинхронный backend на FastAPI с PostgreSQL: 5 986 строк Python, 43 эндпоинта, JWT с ротацией refresh-токенов, Redis-кэш, Celery, 318 автотестов',
      link: '' },
    { name: 'anime-sync-api', keywords: ['fastapi', 'python', 'api', 'postgres', 'sql', 'docker', 'async', 'orm', 'httpx'],
      line: 'anime-sync-api — REST API каталога аниме на FastAPI с PostgreSQL: tsvector + GIN-индекс, идемпотентный апсерт, тесты на двух диалектах',
      link: '' },
    { name: 'practice-automation-tests', keywords: ['test', 'qa', 'selenium', 'pytest', 'автотест', 'ci', 'allure'],
      line: 'practice-automation-tests — 47 UI-автотестов на Selenium и Pytest с отчётами Allure',
      link: 'https://github.com/TeivrimOriginal/practice-automation-tests' },
    { name: 'Anime DB', keywords: ['python', 'api', 'sql', 'docker', 'rest'],
      line: 'Anime DB — каталог из трёх публичных API, JSON API с фильтрами и пагинацией, Android-клиент, 564 юнит-теста',
      link: 'https://github.com/TeivrimOriginal/TeivrimSite' },
  ],
};

/** Условия: что в вакансии совпадает с тем, что нужно человеку. */
function formatLine(vacancy) {
  const bits = [];
  if (vacancy.remote) bits.push('удалённый формат');
  const fmt = `${vacancy.schedule || ''}`.toLowerCase();
  if (/гибк|свободн/.test(fmt)) bits.push('гибкий график');
  else if (/частичн|неполный/.test(fmt)) bits.push('частичная занятость');
  if (/стажер|стажёр|junior|ученик|начальник/i.test(vacancy.title)) bits.push('уровень джуна или стажёра — как раз мой этап');
  if (/команд|в команде/i.test(vacancy.description || '')) bits.push('работа в команде');
  if (!bits.length) return 'Формат работы меня устраивает.';
  const last = bits.pop();
  return `По условиям подходит: ${bits.join(', ')}${bits.length ? ' и ' : ''}${last}.`;
}

/**
 * Собирает письмо. Возвращает объект с subject и body — вставлять можно
 * куда угодно, отправку делает человек.
 *
 * `target` — контакт, по которому письмо уходит (выбирает send.mjs из
 * опубликованных компанией контактов). Он же попадает в текст одной строкой:
 * получателю полезно знать, на какой адрес он ответит.
 *
 * `channel` — куда уходит письмо. Разница одна и она важна: в телеграме и в
 * отклике на hh вложения нет, и фраза «Резюме прикреплено к письму» там была
 * бы враньём. Для таких каналов ставится ссылка на опубликованное резюме.
 *
 * Раньше в письмо вставлялся весь список найденных контактов компании. Для
 * письма это бессмыслица — человеку отправляли обратно его же собственные
 * телефоны и телеграм, будто это визитка кандидата. Контакты нужны для выбора
 * адресата, а не для показа адресату, поэтому в тексте их больше нет.
 */
export function draftLetter(vacancy, { score, target = null, channel = 'email' } = {}) {
  const stack = score?.stack || null;
  const ev = evidenceFor(vacancy, stack, PROFILE);

  const first = `Здравствуйте! Меня зовут ${PROFILE.name}, я ${PROFILE.title}. `
    + (ev.kind === 'project'
      ? `Сейчас веду проект «${ev.name}» — ${ev.line}.`
      : `Работаю на Python с 2022: ${ev.line}.`);

  const second = stack
    ? `Это закрывает требования вакансии по стеку ${stack}: то же, что требуется в описании, только в моём случае оно доведено до тестов и запускается.`
    : 'Стек вакансии частично совпадает с моим опытом — закрываю его текущими проектами и готов быстро доучиться остальное.';

  const facts = PROFILE.facts.slice(0, 3).map((f) => `  • ${f}`).join('\n');
  const links = [
    ev.link && `Проект: ${ev.link}`,
    `Код: ${PROFILE.contacts.github}`,
    channel === 'email'
      ? 'Резюме прикреплено к письму.'
      : `Резюме и примеры работ: ${PROFILE.contacts.portfolio}`,
  ].filter(Boolean).join('\n');

  // Строка про адрес нужна только для почты: в отклике на hh или в сообщении
  // в телеграм «пишу на https://hh.ru/vacancy/123» звучит как бред.
  const targetBlock = (target && channel === 'email')
    ? `Пишу на адрес ${target.value}, который компания публикует сама.`
    : 'Если ответ удобнее получить по ссылке на профиль или в Telegram — это быстрее всего.';

  const body = `${first}\n\n${second}\n\n`
    + `Что умею по делу:\n${facts}\n\n`
    + `${formatLine(vacancy)}\n\n`
    + `${targetBlock}\n\n`
    + `Связь: ${PROFILE.contacts.telegram} · ${PROFILE.contacts.email} · ${PROFILE.contacts.phone}\n`
    + `${links}\n\n`
    + `Готов выполнить тестовое задание и выйти на связь в удобное время.\n\n`
    + `С уважением,\n${PROFILE.name}`;

  const subject = `Отклик на «${vacancy.title}»${vacancy.company ? ` — ${vacancy.company}` : ''}`
    + (score?.stack ? ` (${score.stack})` : '');

  return { subject, body };
}

/**
 * Проверка обещаний: каждое «я умею X» должно встречаться в резюме или в
 * фактах профиля. Возвращает список подозрительных мест — пустой список это
 * хорошо, непустой означает, что письмо врёт.
 */
export function checkClaims(letter, resumeText = '') {
  // Проверяется только прозаическая часть письма. Строка с адресом, на который
  // пишут, и блок контактов — это данные, а не утверждения о себе: телефон
  // заказчика или цифры в названии почтового ящика не имеют отношения к
  // резюме, и проверка ругалась на них как на выдуманный опыт.
  const body = letter.body.split(/Пишу на |Контакты компании|Связь:/)[0];

  const resume = resumeText.toLowerCase();
  // Корпус опоры: резюме, факты профиля и описания проектов. Число «5 986» живёт
  // именно в фактах, а не в HTML-резюме, поэтому искать надо по обоим.
  const corpus = `${resume} ${PROFILE.facts.join(' ')} ${PROFILE.projects.map((p) => p.line).join(' ')}`.toLowerCase();
  const suspicious = [];

  // Числа в письме должны быть в корпусе. Нормализуем разделители: в письме
  // «5 986», в исходнике «5986» — это одно и то же число.
  const norm = (s) => s.replace(/[\s\u00a0]/g, '');
  const corpusNorm = norm(corpus);
  // Требование: 3 цифры подряд с пробелами внутри — это телефон или ИНН,
  // а не показатель проекта. Такие не проверяем.
  const isPhoneish = (n) => /^\d{3}[\d\s]{8,}$/.test(n) || n.length >= 10;
  const numbers = [...body.matchAll(/\b(\d[\d\s]{2,})\b/g)].map((m) => norm(m[1])).filter((n) => !isPhoneish(n));
  for (const n of new Set(numbers)) {
    if (!corpusNorm.includes(n)) suspicious.push(`число «${n}» не найдено в резюме и фактах`);
  }

  // Технологии, которых нет ни в резюме, ни в проектах.
  const claims = ['kafka', 'k8s', 'kubernetes', 'clickhouse', 'spark', 'scala', 'java', 'php', 'ansible'];
  for (const c of claims) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(body) && !corpus.includes(c)) {
      suspicious.push(`упомянута технология «${c}», которой нет в резюме`);
    }
  }

  // Слова, обещающие опыт, которого нет.
  const overclaims = [/коммерческий опыт \d+/i, /опыт работы более/i, /\d+ лет в разработке/i, /middle|senior/i];
  for (const re of overclaims) {
    if (re.test(body)) suspicious.push(`формулировка «${body.match(re)[0]}» претендует на опыт, которого нет`);
  }

  return suspicious;
}
