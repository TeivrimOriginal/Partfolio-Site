// Скоринг вакансии: 0–100 с объяснением.
//
// Правило из ТЗ: письмо уходит, если резюме подходит на 50 и выше, ниже —
// вакансия попадает в LeaksData. Значит скоринг обязан быть честным и
// разложимым: не «AI решил», а видно, за что начислены баллы.
//
// Пять составляющих, каждая со своим весом:
//   40  стек        — пересечение требований вакансии и навыков резюме
//   20  формат      — удалёнка, частичная занятость, гибкий график
//   15  контакты    — нашлись живые контакты и сайт компании
//   15  каналы      — сколько разных площадок уже использовано по вакансии
//   10  свежесть    — насколько вакансия ещё актуальна
//
// Сумма может превысить 100 — она и должна показывать сильную вакансию, но
// в интерфейсе показывается минимум из 100.

/**
 * Профессии, которые не ИТ-разработка, хотя слова «инженер», «api» и «сервер»
 * в них встречаются. Без этого списка «Инженер по внедрению SIEM» набирал
 * 56 баллов как Backend и стоял первым в очереди.
 *
 * Границы слов ручные: \b и \w в JavaScript по кириллице не работают.
 */
const NOT_ENGINEERING_TERMS = [
  // Короткие корни ловятся без границ: «1с» в «Программист 1С», «продаж» в
  // «менеджер по продажам». Слова короче четырёх букв границами не ловятся —
  // поэтому для них граница не ставится, а для длинных нужна.
  'siem', '1c', '1с', 'продаж', 'юрист', 'бухгалтер', 'рекрутер',
  'кадров', 'маркетолог', 'seo', 'контент', 'копирайт', 'дизайнер', 'логист',
  'кладовщик', 'грузчик', 'курьер', 'продавец', 'кассир', 'уборщик', 'официант', 'повар',
  'врач', 'медсестр', 'фармацевт', 'психолог', 'педагог', 'преподавател', 'тренер',
  'автомеханик', 'электрик', 'сварщик', 'монтажник', 'машинист', 'помощник руководител',
  'секретарь', 'офис менеджер', 'администратор здани', 'ассистент менеджера',
  'бизнес аналитик', 'аналитик рынка', 'аналитик продукт', 'юрисконсульт', 'таксист',
  'водител', 'складщик', 'комплектовщик', 'упаковщик', 'косметолог', 'визажист',
  'парикмахер', 'бармен', 'кальянщик', 'ветеринар', 'стоматолог', 'психотерапевт',
  'retention', 'igaming', 'менеджер проект', 'project manager', 'product manager',
  'продакт', 'account manager', 'клиент менеджер', 'менеджер по работе с клиент',
];

/**
 * Границы заданы руками: `\b` и `\w` в JavaScript по кириллице не работают.
 * Регулярка строится из списка, а не пишется одной строкой: длинный литерал
 * нечитаем и один раз у��е содержал незакрытую группу.
 */
const NOT_ENGINEERING_RE = new RegExp(
  `(?:^|[^а-яёa-z])(?:${NOT_ENGINEERING_TERMS.join('|')})`,
  'iu',
);

/**
 * Отдельная проверка по коротким корням без границ.
 *
 * Предыдущая версия ловила «продаж» только в точной форме «менеджер по продаж»,
 * поэтому «Ассистент менеджера по продажам Битрикс24» проходил как Backend
 * и получал 65 баллов. Границы слов для коротких корней вроде «1с» и «продаж»
 * неприменимы: в кириллице \b не работает, а «(^|…)1с» требует пробела перед «1».
 */
const NOT_ENGINEERING_SHORT_RE = new RegExp(NOT_ENGINEERING_TERMS.slice(0, 6).join('|'), 'iu');

const isNotEngineering = (title, description = '') =>
  NOT_ENGINEERING_RE.test(title) || NOT_ENGINEERING_SHORT_RE.test(title)
  || NOT_ENGINEERING_SHORT_RE.test(description.slice(0, 600));

const STACKS = {
  python: {
    label: 'Python',
    must: [/python/i, /ООП|ООП\b|типизац/i, /asyncio|асинхрон/i, /фреймворк|django|flask|fastapi/i],
    nice: [/rest|api/i, /sql\b|postgres|postgresql|sqlite/i, /docker|контейнер/i, /celery|очеред/i, /pytest|тест/i, /git/i, /linux/i],
  },
  backend: {
    label: 'Backend',
    // «инженер» и «сервер» больше не признаки backend: ими помечаются сисадмины,
    // DevOps и инженеры по внедрению. Признак — связка с API или БД.
    must: [/backend|бэкенд/i, /(?:rest|graphql|api)\s+для/i, /разработчик\s+api/i, /api\s+интеграц/i, /микросервис/i],
    nice: [/postgres|postgresql|redis|mongo/i, /docker|k8s|kubernetes/i, /очеред|celery|kafka|rabbit/i, /кэш|cache/i, /pytest|тест/i, /git/i],
  },
  qa: {
    label: 'QA / тестирование',
    must: [/тест|qa|quality/i, /автотест|автоматизаци/i],
    nice: [/selenium|playwright|cypress/i, /pytest|jest|junit/i, /api|rest|sql/i, /postman|soap|graph/i, /ci|jenkins|github actions/i, /allure|report/i],
  },
  devops: {
    label: 'DevOps',
    must: [/devops|sre|инфраструктур/i, /ci|cd|pipeline/i],
    nice: [/docker|контейнер|k8s|kubernetes/i, /linux|unix|bash/i, /ansible|terraform/i, /prometheus|grafana|монитор/i, /gitlab|github actions/i, /nginx|proxy/i],
  },
  data: {
    label: 'Данные',
    must: [/аналитик|данн|data|etl/i],
    nice: [/sql\b|postgres/i, /python|pandas/i, /spark|airflow|dbt/i, /power ?bi|tableau|дашборд/i, /airtable/i],
  },
};

export const STACK_KEYS = Object.keys(STACKS);

function detectStacks(vacancyText, title) {
  const text = `${title} ${vacancyText}`;

  // Не-разработка отсекается до определения стека, иначе «инженер по внедрению
  // SIEM» находит в себе «api» и проходит как Backend с полными 40 баллами.
  if (isNotEngineering(title, vacancyText)) return [];

  const found = [];
  for (const [key, s] of Object.entries(STACKS)) {
    const mustHits = s.must.filter((re) => re.test(text)).length;
    const niceHits = s.nice.filter((re) => re.test(text)).length;
    if (mustHits === 0) continue;
    const total = (mustHits / s.must.length) * 0.6 + (niceHits / s.nice.length) * 0.4;
    found.push({ key, label: s.label, weight: total });
  }
  found.sort((a, b) => b.weight - a.weight);
  return found;
}

/** Резюме против стека вакансии: пересечение навыков и требований. */
/**
 * Ключевое слово из регулярки для сопоставления с навыками резюме.
 *
 * Берётся первый содержательный кусок шаблона, а не сам текст требования:
 * вакансия пишет «Опыт коммерческой разработки от 1 года», а в навыках резюме
 * есть «python» — сравнивать надо по существу вопроса, а не по формулировке.
 */
function needleOf(re) {
  const raw = re.source
    .replace(/\\b/g, ' ')
    .split('|')
    .map((part) => part.replace(/[\\^$.*+?()[\]{}]/g, ' ').trim())
    .filter((part) => part.length >= 3)[0];
  if (!raw) return '';
  // Берём самое длинное слово из куска: «github actions» полезнее, чем «github».
  const words = raw.split(/[\s/]+/).filter((w) => w.length >= 3);
  if (!words.length) return '';
  return words.sort((a, b) => b.length - a.length)[0].toLowerCase();
}

export function resumeMatch(vacancy, resumeSkills = []) {
  const text = `${vacancy.title} ${vacancy.description || ''} ${vacancy.requirements || ''}`;
  const vStacks = detectStacks(text, vacancy.title);
  if (!vStacks.length) return { score: 0, why: ['в описании не найдено ни одного известного стека'], stack: null };

  const primary = vStacks[0];
  const skills = resumeSkills.map((s) => String(s).toLowerCase());
  const sText = skills.join(', ');

  // Какие требования вакансии закрываются навыками резюме.
  const matched = [];
  const missing = [];
  for (const re of [...STACKS[primary.key].must, ...STACKS[primary.key].nice]) {
    const needle = needleOf(re);
    if (!needle || needle.length < 3) continue;
    if (sText.includes(needle)) matched.push(needle);
    else if (re.test(text)) missing.push(needle);
  }

  const total = matched.length + missing.length || 1;
  const ratio = matched.length / total;
  return {
    score: Math.round(ratio * 40),
    stack: primary.label,
    stackWeight: primary.weight,
    matched: [...new Set(matched)].slice(0, 8),
    missing: [...new Set(missing)].slice(0, 8),
    why: [`стек вакансии: ${primary.label}`,
      `навыки резюме закрывают ${matched.length} из ${total} требований (${Math.round(ratio * 100)}%)`],
  };
}

/** Формат работы: что реально совмещается с учёбой. */
export function formatScore(vacancy) {
  let score = 0;
  const why = [];
  const fmt = `${vacancy.formats || ''} ${vacancy.schedule || ''}`.toLowerCase();

  if (vacancy.remote) { score += 12; why.push('удалённая работа'); }
  if (/гибк|свободн/.test(fmt)) { score += 5; why.push('гибкий или свободный график'); }
  if (/частичн|неполный|4, 6|4, 5/.test(fmt)) { score += 3; why.push('частичная занятость указана'); }
  if (/вахт|суточ|5\/2|работа в ноч/.test(fmt)) { score -= 4; why.push('есть признаки вахты или полного дня — минус'); }
  return { score: Math.max(0, Math.min(20, score)), why };
}

/** Контакты и каналы: влияют на вероятность, что ответят вообще. */
export function reachScore(contactCount, channelCount, hasSite) {
  let score = 0;
  const why = [];
  if (contactCount > 0) {
    score += Math.min(10, contactCount * 3);
    why.push(`найдено контактов: ${contactCount}`);
  } else {
    why.push('контактов пока нет — это самый узкий канал');
  }
  if (hasSite) { score += 5; why.push('у компании есть сайт'); }
  if (channelCount >= 2) {
    score += 5;
    why.push(`использовано каналов: ${channelCount} — вакансия не забыта после первого канала`);
  } else if (channelCount === 1) {
    score += 2;
    why.push('канал один');
  }
  return { score: Math.min(15, score), why };
}

export function freshnessScore(vacancy) {
  const till = vacancy.valid_through || vacancy.validThrough;
  if (!till) return { score: 6, why: ['срок не указан'] };
  const days = Math.round((new Date(till).getTime() - Date.now()) / 86400000);
  if (days <= 0) return { score: 0, why: ['срок истёк'] };
  if (days <= 2) return { score: 6, why: [`осталось ${days} дн — горит`], urgent: true };
  if (days <= 7) return { score: 8, why: [`осталось ${days} дн`], urgent: true };
  if (days <= 21) return { score: 10, why: [`осталось ${days} дн`] };
  return { score: 8, why: [`осталось ${days} дн`] };
}

export const THRESHOLD = 50;

/**
 * Полный расчёт. Возвращает и балл, и разбор — разбор обязателен, иначе
 * порог 50 невозможно оспорить.
 */
export function scoreVacancy(vacancy, { resumeSkills = [], contactCount = 0, channelCount = 0, hasSite = false } = {}) {
  const parts = [];
  const stack = resumeMatch(vacancy, resumeSkills);
  parts.push({ name: 'Стек', got: stack.score, max: 40, why: stack.why });
  const fmt = formatScore(vacancy);
  parts.push({ name: 'Формат', got: fmt.score, max: 20, why: fmt.why });
  const reach = reachScore(contactCount, channelCount, hasSite);
  parts.push({ name: 'Контакты', got: reach.score, max: 15, why: reach.why });
  const fresh = freshnessScore(vacancy);
  parts.push({ name: 'Свежесть', got: fresh.score, max: 10, why: fresh.why });

  const raw = parts.reduce((s, p) => s + p.got, 0);
  const percent = Math.max(0, Math.min(100, raw));
  return {
    percent,
    raw,
    threshold: THRESHOLD,
    passed: percent >= THRESHOLD,
    stack: stack.stack || null,
    matched: stack.matched || [],
    missing: stack.missing || [],
    urgent: !!fresh.urgent,
    parts,
    verdict: percent >= 75
      ? 'шанс высокий: стек совпадает, каналы доступны'
      : percent >= THRESHOLD
        ? 'шанс средний: добрать контакты — и можно отправлять'
        : 'шанс низкий: резюме под вакансию не подходит, уходит в LeaksData',
  };
}