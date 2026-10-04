// Куда откликаться, а куда нет.
//
// Правило выведено из данных hh за 04.10.2026: 76 откликов, 11 собеседований,
// 32 отказа, причём 14 отказов из 15 последних — Aston. Aston держит на hh
// вакансии «ученик/стажер» с чужим стеком (Java, 1С, React) — это реклама
// бесплатного обучения, а не найм: в описании «Ступень I / Ступень II / Ступень III»
// и «ежегодно обучаем 900+ человек». Он берёт поток на всё подряд и отсекает 98%.
//
// Все 11 собеседований пришли из вакансий, совпадающих с позиционированием:
// Python/FastAPI, Python-разработчик по автоматизации, Telegram-боты, QA,
// тестировщик. Значит резюме работает, а ломало его то, куда я отправлял.
//
// Правило: не откликаться туда, где нет шанса без опыта в чужом стеке.
// Каждый такой отклик не только бесполезен, но и портит статистику профила.
//
// ─────────────────────────────────────────────────────────────────────────────
// ДВА ОГРАНИЧЕНИЯ НА СИНТАКСИС ПРАВИЛ. Оба проверены тестом, не соблюдайтесь
// с ними на свой страх.
//
// 1. НИ ОДНОГО escape-последовательност�� (\b, \w, \s, \., \+, \/) в правилах.
//
//    Причина не эстетическая. Правила уезжают в браузер строкой, и escape в
//    строковом литерале JS живёт своей жизнью: new RegExp("java\b") ищет
//    «java», за которой символ BACKSPACE, и не срабатывает никогда. Именно так
//    из 497 ваканс��й протекли «Java-Разработчик», «Java Backend разработчик» и
//    «Инженер по автоматизации тестирования 1C» — по одному только \b.
//    Границы слов задаются классами символов и lookaround: [a-z], (?<![a-z]).
//
// 2. ГРАНИЦА СЛОВА — ЭТО ЯВНЫЙ КЛАСС, А НЕ \b.
//
//    В JavaScript \w — только [A-Za-z0-9_], кириллицу буквой он не считает.
//    Так что \bбот\b не сработал бы никогда, а \w+ не смог бы пройти по «ого»
//    в «машинного обучения». Для русского границы только через (?<![а-яё]) и
//    (?!а-яё]), и только со списком букв внутри скобок.
//
// Оба ограничения проверяются в test-target-serialized.js: тест падает, если
// в источнике правила появился обратный слэш.

// Класс «буква» для русского и латинского текста. Скобки входят в значение
// намеренно: RU подставляется внутрь (?<!...) и (?![...]).
const RU = '[а-яёa-z]';

// Роли, где слово «инженер» — не про софт. /инженер/i входит в ALLOW, потому что
// «Инженер по тестированию» и «DevOps-инженер» — его стек, но без этих правил в
// список попадали «Инженер ПТО», «Инженер-обследователь», «Инженер группы
// обследователей зданий и сооружений».
const BLOCK_NON_IT = [
  new RegExp('обследовател', 'i'),
  new RegExp('пто(?!' + RU + ')', 'i'),
  new RegExp('проектирован(?!' + RU + ')', 'i'),
  new RegExp('фкр(?!' + RU + ')', 'i'),
  new RegExp('строител|здани|сооружени', 'i'),
  new RegExp('сметчик|сметы(?!' + RU + ')|геодези', 'i'),
  new RegExp('технолог(?!ическ)', 'i'),
  new RegExp('электрик|сантехник', 'i'),
  new RegExp('недвижимост|риелтор|автосервис', 'i'),
];

// Уровень. Он джуна: senior, middle и lead не берут без коммерческого опыта,
// а «Откликнуться» на такую вакансию только тратит лимит и портит статистику.
// Метки junior и стажёр при этом остаются, а «от года» на джуна завышено —
// 11 собеседований как раз пришли оттуда.
const BLOCK_SENIORITY = [
  new RegExp('senior|[.]sr(?![a-z])|staff|principal', 'i'),
  new RegExp('middle[+]?(?![a-z])', 'i'),
  new RegExp('lead|team ?lead', 'i'),
  new RegExp('ведущ|старш(ий|ая|ее)', 'i'),
  new RegExp('руководител|руковод|директор|главный|управляющ', 'i'),
];

// Технологии, которых у него нет. Список вырос из реальной выдачи hh: сняв
// фильтр «без опыта», я получил 311 вакансий, и среди них были C#, .NET,
// TypeScript, Node.js, Go, ML, MLOps, fullstack, mobile, Big Data, SIEM,
// нагрузочное тестирование, desktop-тестирование, реверс-инжиниринг, ROS,
// Android, наставничество и работа с ИБ.
const BLOCK_OTHER_TECH = [
  new RegExp('[.]net|c#|typescript|node[.]?js', 'i'),
  new RegExp('(?<![a-z])go(?![a-z])', 'i'),
  new RegExp('full ?-?stack', 'i'),
  new RegExp('мобильн|mobile|kmp|android', 'i'),
  new RegExp('ml-?инженер|mlops|ml инженер|mle', 'i'),
  new RegExp('(?<![а-яёa-z])ml(?![а-яёa-z])', 'i'),
  new RegExp('дата сайенс|data scientist', 'i'),
  new RegExp('opencv|computer vision|tensorflow|pytorch', 'i'),
  new RegExp('clickhouse|big ?data|hadoop|spark|mongo|cassandra', 'i'),
  new RegExp('нагрузочн|performance qa|jmeter', 'i'),
  new RegExp('desktop|1с-приложен', 'i'),
  new RegExp('реверс|reverse engineer', 'i'),
  new RegExp('сетев(ой|ого|ое|ом) (инженер|оборудован)', 'i'),
  new RegExp('системный администратор|сисадмин|системник', 'i'),
  new RegExp('siem|kaspersky|инженер внедрения|внедрен(ие|ия) ии', 'i'),
  new RegExp('1с[: ]|1c[: ]|битрикс', 'i'),
  new RegExp('support|поддержк', 'i'),
  new RegExp('embedded|микроконтроллер|fpga', 'i'),
  new RegExp('gamedev|ros[ /]|gazebo|программист робота', 'i'),
  new RegExp('vibe cod', 'i'),
  new RegExp('наставник|эксперт-исследователь|bpmsoft', 'i'),
  // Добавлены после прогона collect-remote-junior.js: эти заголовки проходили
  // отбор, хотя среда чужая. Vanessa — это автоматизация тестов под 1С,
  // Bitrix24 — не backend, «Инженер по внедрению» — это внедрение чужого
  // софта у заказчика, а не разработка.
  new RegExp('vanessa|vanessa automation', 'i'),
  new RegExp('bitrix24|битрикс24|bitrix ?24', 'i'),
  new RegExp('инженер по внедрени|инженер-по-внедрени', 'i'),
  // Мобильная среда. Раньше ловилось только по слову «мобильн», и iOS-вакансии
  // доходили до отбора: «IOS QA», «IOS-разработчик», а мобильных приложений у
  // него нет. Правило и на кириллицу, потому что пишут «айос».
  new RegExp('(?<![a-z])ios(?![a-z])|(?<![а-яё])айос(?![а-яё])', 'i'),
  new RegExp('кадастр|кадастров|геодези', 'i'),
  // Телефонная балансировка, КИПиА, телефония — это инженерная работа со связью,
  // а не разработка. Проходила по общему слову «инженер» в правилах отбора.
  new RegExp('балансиров|телефони|связь|кипиа|кип|оборудован', 'i'),
  // Функциональные языки и JVM-стек, которых у него нет. «Scala разработчик»
  // проходил, потому что правила знали про Java, но не про Scala.
  new RegExp('(?<![а-яёa-z])(scala|kotlin|clojure|elixir|erlang|f#|dart|flutter)(?![а-яёa-z])', 'i'),
  // Эксплуатация инженерных сетей: у Хабра это «Инженер технической службы»
  // газопровода, проходило по общему слову «инженер».
  new RegExp('технической службы|технический отдел|производственн|газопровод|пгс', 'i'),
  // BI и хранилища данных: от «BI/AI-инженер» до «Инженер по продукту СХД».
  // Ограничение по буквам, потому что короткое «би» встречается внутри слов.
  new RegExp('(?<![a-z0-9])bi(?![a-z0-9])[-/ ]?инженер', 'i'),
  new RegExp('дата инженер|data[- ]инженер|инженер данных|(?<![а-яё])data engineer', 'i'),
  new RegExp('системы хранения данных|(?<![а-яё])схд(?![а-яё])', 'i'),
  // «BI/AI-инженер»: правило выше проверяло «bi», дефис и слово «инженер»
  // подряд, поэтому слеш с буквами посередине его ломал.
  new RegExp('(?<![a-z0-9])bi(?![a-z0-9])([-/ ]?ai)?[-/ ]?инженер', 'i'),
  // AI-разработка требует ML и обучение моделей, а не то, что у него есть.
  new RegExp('(?<![a-z0-9])ai(?![a-z0-9])[-/ ]?(инженер|разработчик)|инженер[ -]ии', 'i'),
  // «Тестировщик Roblox-игр» проходило, потому что правило ловило только
  // «игров» и «gamedev». Теперь ловится и «-игр», и «Roblox» отдельно.
  new RegExp('roblox|игр(?!а)', 'i'),
  // Слово «проектировщик» не содержит «проектирован», поэтому прежнее правило
  // его пропускало, хотя вакансия чуждая такая же, как «Инженер-проектировщик».
  new RegExp('проектировщик', 'i'),
  // Круглосуточный мониторинг инфраструктуры — это эксплуатация, а не
  // разработка. «Инженер мониторинга (Zabbix)» в Ви.Тех проходил отбор,
  // хотя у него нет ни Zabbix, ни опыта дежурной смены.
  new RegExp('инженер мониторинга|мониторинг[а-яё]* (инфраструктур|иt)', 'i'),
];

// Работодатели, где отказ не значит ничего и только портит статистику.
const BLOCK_COMPANY = [/aston/i];

// Работодатели, с которыми уже идёт диалог. Повторные отклики туда же ничего
// не добавляют: у Crowdtesting.ru уже пять собеседований на «Тестировщик», а
// выдача продолжает предлагать шестые такие же вакансии.
const ENGAGED_COMPANY = [
  /crowdtesting/i,
  // Тот же крауд, но под именем «Яндекс Крауд: Качество продуктов». Правило на
  // /crowdtesting/i его не видело, и в одном прогоне в выдачу попали сразу
  // 17 таких вакансий: «Автотестировщик в крауд-тестирование» от 1–3 лет.
  /крауд/i,
  /даньшин/i,
  /симикян/i,
  /гришаенок/i,
  /умскул/i,
  /солар/i,
];

// Название вакансии должно совпасть хотя бы с одним — иначе не берём.
const ALLOW = [
  /python/i,
  /backend/i, /бэкенд/i,
  /автоматизац/i, /автомат/i,
  /парсинг/i, /парсер/i,
  /telegram/i,
  new RegExp('(?<!' + RU + ')бот(?!авиа)(?!' + RU + ')', 'i'),
  new RegExp('(?<![a-z])bot(?![a-z])', 'i'),
  new RegExp('(?<![a-z])qa(?![a-z])', 'i'),
  /тестировщик/i,
  new RegExp('тест-?инженер|инженер по тестированию|автотест', 'i'),
  /devops/i,
  new RegExp('(?<![a-z])sre(?![a-z])', 'i'),
  /аналитик данных/i,
  new RegExp('(?<![a-z])(sql|api|rest)(?![a-z])', 'i'),
  /микросервис/i,
  /инженер/i,
  /разработчик/i,
  /программист/i,
];

// Совпадение — отказ. Это стеки, которых у него нет, и под низы вроде поддержки.
const BLOCK = [
  new RegExp('(?<![a-z])java(?![a-z])', 'i'),
  new RegExp('(?<![a-z])1c(?![a-z])', 'i'),
  new RegExp('1 ?с(?!' + RU + ')', 'i'),
  /erp/i,
  new RegExp('javascript|(?<![a-z])js(?![a-z])', 'i'),
  new RegExp('react|vue(?![a-z])|angular', 'i'),
  new RegExp('frontend|фронтенд', 'i'),
  new RegExp('php|ruby|golang', 'i'),
  new RegExp('unity|unreal', 'i'),
  new RegExp('game ?dev|(?<![а-яёa-z])игров(?![а-яёa-z])', 'i'),
  /1с-разработчик/i,
  new RegExp('бухгалт|финанс|юрист', 'i'),
  new RegExp('технической поддержки|техподдержк', 'i'),
  new RegExp('(?<![а-яёa-z])дежурный(?![а-яёa-z])', 'i'),
  new RegExp('сервисной службы|call-?центр', 'i'),
  new RegExp('(?<![а-яёa-z])оператор(?![а-яёa-z])', 'i'),
  new RegExp('продавец|менеджер|маркетолог|рекрутер|подбор', 'i'),
  new RegExp('дизайнер|ui[/]ux', 'i'),
  new RegExp('(?<![a-z])ux(?![a-z])', 'i'),
  new RegExp('дата-инженер|(?<![a-z])data(?![a-z])engineer', 'i'),
  new RegExp('машинн[а-яёa-z0-9]* обучени|нейросет', 'i'),
  new RegExp('информационной безопасности|ибилиотеч', 'i'),
  new RegExp('репетитор|преподавател', 'i'),
  new RegExp('(?<![а-яёa-z])контент(?![а-яёa-z])', 'i'),
  /ассистент/i,
  new RegExp('аналитик power ?bi|(?<![a-z])power ?bi(?![a-z])', 'i'),
  new RegExp('системный аналитик|бизнес-аналитик', 'i'),
  new RegExp('стаж(е|ё)р отдела', 'i'),
  // ...и роли не из софта, уровни и технологии.
  ...BLOCK_NON_IT,
  ...BLOCK_SENIORITY,
  ...BLOCK_OTHER_TECH,
];

const REASONS = {
  blockTitle: 'чужой стек, уровень или не та роль',
  blockCompany: 'отборщик массово режет',
  alreadyEngaged: 'с этой компанией уже идёт диалог',
  noMatch: 'тема не похожа на разработку',
  noExperience: 'требуется опыт',
  notRemote: 'не удалённая',
  alreadyApplied: 'отклик уже есть',
  closed: 'вакансия недоступна',
  captcha: 'капча hh',
};

/**
 * Разбор с указанием сработавшего правила.
 *
 * Нужно для отчёта: по одному «ok» непонятно, почему вакансия попала в список, а
 * по номеру правила видно, какое правило слишком широкое и что надо подтянуть.
 * Так и нашлись ложные срабатывания: «бот» внутри слова «работы», «инженер» из
 * «Инженер ПТО», Java и 1С, ушедшие из-за \b, и копии одной вакансии у Яндекс
 * Крауд и Ozon Банка.
 *
 * @param {{id?: string, title: string, co?: string, remote?: boolean, noExp?: boolean}} v
 * @returns {{ok: boolean, reason?: string, rule?: number}}
 */
function judge(v) {
  const title = v.title || '';
  const company = v.co || v.company || '';

  for (let i = 0; i < BLOCK_COMPANY.length; i++) {
    if (BLOCK_COMPANY[i].test(company)) return { ok: false, reason: 'blockCompany', rule: i };
  }
  for (let i = 0; i < ENGAGED_COMPANY.length; i++) {
    if (ENGAGED_COMPANY[i].test(company)) return { ok: false, reason: 'alreadyEngaged', rule: i };
  }
  for (let i = 0; i < BLOCK.length; i++) {
    if (BLOCK[i].test(title)) return { ok: false, reason: 'blockTitle', rule: i };
  }
  let hit = -1;
  for (let i = 0; i < ALLOW.length; i++) {
    if (ALLOW[i].test(title)) { hit = i; break; }
  }
  if (hit < 0) return { ok: false, reason: 'noMatch', rule: -1 };
  if (v.applied) return { ok: false, reason: 'alreadyApplied', rule: hit };
  if (v.noExp === false || v.noExperience === false) {
    return { ok: false, reason: 'noExperience', rule: hit };
  }
  if (v.remote === false) return { ok: false, reason: 'notRemote', rule: hit };

  return { ok: true, rule: hit };
}

/**
 * @param {{title: string, company?: string, remote?: boolean, noExperience?: boolean, applied?: boolean}} v
 * @returns {{ok: boolean, reason?: string, rule?: number}}
 */
function isWorthApplying(v) {
  return judge({
    id: v.id,
    title: v.title,
    co: v.company,
    remote: v.remote,
    noExp: v.noExperience,
    applied: v.applied,
  });
}

/**
 * Сериализует те же правила в исходник функции для страницы.
 *
 * Зачем так: правила должны быть ровно одни. Если бы фильтр жил отдельно в
 * браузерном скрипте, он рано или поздно разошёлся бы с этим файлом, и я снова
 * начал бы слать отклики туда, куда нельзя. Здесь единственный источник правды,
 * а страница получает его копию, собранную из ALLOW/BLOCK.
 *
 * @param {string[]} appliedIds
 * @returns {string} исходник, вставляемый в evaluate()
 */
function pageFilterSource(appliedIds) {
  // re.source, а не String(re): String(/python/i) даёт "/python/i" вместе со
  // слэшами, и такая регулярка ищет литеральный текст "/python/i" — то есть не
  // срабатывает никогда. На этом молча отсеивались все 92 вакансии.
  return (
    'var __ALLOW=' + JSON.stringify(ALLOW.map((re) => re.source)) + ';' +
    'var __BLOCK=' + JSON.stringify(BLOCK.map((re) => re.source)) + ';' +
    'var __BLOCKC=' + JSON.stringify(BLOCK_COMPANY.map((re) => re.source)) + ';' +
    'var __ENGAGED=' + JSON.stringify(ENGAGED_COMPANY.map((re) => re.source)) + ';' +
    'var __DONE=' + JSON.stringify(appliedIds || []) + ';' +
    'var __ALLOW_R=__ALLOW.map(function(s){return new RegExp(s,"i");});' +
    'var __BLOCK_R=__BLOCK.map(function(s){return new RegExp(s,"i");});' +
    'var __BLOCKC_R=__BLOCKC.map(function(s){return new RegExp(s,"i");});' +
    'var __ENGAGED_R=__ENGAGED.map(function(s){return new RegExp(s,"i");});' +
    'function judge(v){\n' +
    '  var t=v.title||"", co=v.co||"", i;\n' +
    '  for(i=0;i<__BLOCKC_R.length;i++) if(__BLOCKC_R[i].test(co)) return {reason:"blockCompany", rule:i};\n' +
    '  for(i=0;i<__ENGAGED_R.length;i++) if(__ENGAGED_R[i].test(co)) return {reason:"alreadyEngaged", rule:i};\n' +
    '  for(i=0;i<__BLOCK_R.length;i++) if(__BLOCK_R[i].test(t)) return {reason:"blockTitle", rule:i};\n' +
    '  var hit=-1;\n' +
    '  for(i=0;i<__ALLOW_R.length;i++) if(__ALLOW_R[i].test(t)) { hit=i; break; }\n' +
    '  if(hit<0) return {reason:"noMatch", rule:-1};\n' +
    '  if(__DONE.indexOf(v.id)>=0) return {reason:"alreadyApplied", rule:hit};\n' +
    '  if(v.remote===false) return {reason:"notRemote", rule:hit};\n' +
    '  if(v.noExp===false) return {reason:"noExperience", rule:hit};\n' +
    '  return {reason:"", rule:hit};\n' +
    '}'
  );
}

module.exports = {
  RU,
  ALLOW,
  BLOCK,
  BLOCK_COMPANY,
  ENGAGED_COMPANY,
  BLOCK_NON_IT,
  BLOCK_SENIORITY,
  BLOCK_OTHER_TECH,
  REASONS,
  judge,
  isWorthApplying,
  pageFilterSource,
};
