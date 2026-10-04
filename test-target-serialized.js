const { pageFilterSource, judge, BLOCK_NON_IT, ENGAGED_COMPANY } = require('./hh-target.js');
// ГЛАВНАЯ ПРОВЕРКА ФАЙЛА. Escape-последовательность в источнике правила при
// переносе строки в браузер превращается в символ: new RegExp("java\b") ищет
// «java» + BACKSPACE. Так из 497 вакансий протекли «Java-Разработчик» и
// «Инженер по автоматизации тестирования 1C». Если в правилах снова появится
// обратный слэш, тест должен упасть здесь, а не на реальной выдаче hh.
const ALL = [...require('./hh-target.js').ALLOW, ...require('./hh-target.js').BLOCK,
  ...require('./hh-target.js').BLOCK_NON_IT, ...require('./hh-target.js').BLOCK_SENIORITY,
  ...require('./hh-target.js').BLOCK_OTHER_TECH, ...require('./hh-target.js').ENGAGED_COMPANY,
  ...require('./hh-target.js').BLOCK_COMPANY];
const withEscape = ALL.map((r) => r.source).filter((s) => s.includes(String.fromCharCode(92)));
let guard = 0;
if (withEscape.length) {
  guard++;
  console.log('ESCAPE В ПРАВИЛАХ (ломается при переносе в браузер):');
  withEscape.forEach((s) => console.log('  ' + JSON.stringify(s)));
}

const src = pageFilterSource(['111111111']);
const jInPage = new Function(src + '; return judge;')();

const blocked = [
  ['Java разработчик/Java Developer (стажер)', 'Aston'],
  ['Системный аналитик (стажер)', 'Aston'],
  ['QA Engineer Java/Инженер-тестировщик Java (ученик)', 'Aston'],
  ['Стажер отдела информационной безопасности', 'Солар'],
  ['Стажер технической поддержки devops', 'Bothost'],
  ['Специалист технической поддержки 1С и торгового оборудования', 'ККМ24'],
  ['Бизнес аналитик', 'ИП Ельмикеев'],
  ['Дата инженер (ученик)', 'Aston'],
  ['Стажёр по работе с нейросетями (Codex)', 'ООО Транском'],
  ['Стажер-инженер технологий машинного обучения', 'ООО Р-Вижн'],
  ['Content Tech Specialist / Технический специалист по работе с образовательным контентом', 'Novakid Inc'],
  ['Data scientist (Junior) в консалтинг', 'Консалтинг'],
  ['Младший специалист по машинному обучению', 'Х'],
  ['Преподаватель Python в IT школу', 'Школа'],
  ['Junior Media Buyer', 'Агентство'],
  ['Личный ассистент директора digital-агентства', 'Агентство'],
  ['Оператор GLAZ', 'Глаз'],
  // ложные срабатывания, найденные на реальной выдаче hh 04.10.2026
  ['Инженер группы обследователей зданий и сооружений / Инженер-Обследователь / Инженер ПГС', 'ООО АктивПроект'],
  ['Инженер ПТО', 'ООО Альфа-Строй'],
  ['Инженер - обследователь (проектирование ФКР)', 'ИП Ермолаев'],
  // уровень: джуна на senior/middle/lead не берут, ждать приглашения бесполезно
  ['Senior Python Developer', 'ООО Ромашка'],
  ['Middle Python - разработчик', 'ООО Ромашка'],
  ['Python Backend Engineer Senior', 'Копылова'],
  ['Ведущий Python разработчик', 'ООО ИТ-Экспертиза'],
  ['Старший инженер по автоматизации тестирования, Python, API, Ozon Bank', 'Ozon Банк'],
  ['Lead Python Developer', 'Матвеева'],
  ['Team Lead Python', 'X5 Tech'],
  ['DevOps Engineer (senior)', 'СберЗдоровье'],
  // чужие стеки, которые пришли после снятия фильтра «без опыта»
  ['Java-Разработчик', 'ООО Цифровые привычки'],
  ['.NET разработчик Middle+/Senior', 'ООО Верный Код'],
  ['Backend .NET разработчик', 'Finstar Financial Group'],
  ['C#/.NET-разработчик', 'ООО Верный Код'],
  ['TypeScript-разработчик (backend)', 'IT Solutions Management'],
  ['Fullstack-разработчик (TypeScript / Node.js), Middlе', 'ИП Мыздриков'],
  ['Fullstack разработчик Middle+/Senior', 'ДЖЕЙКЕТ'],
  ['Мобильный разработчик (KMP+AI)', 'X5, Медиа'],
  ['ML-инженер (Senior)', 'Дром'],
  ['MLOps (Инженер LLM-инфраструктуры)', 'Битрикс24'],
  ['Инженер по нагрузочному тестированию', 'ООО ИЦ АЙ-ТЕКО'],
  ['Тестировщик ПО (Desktop-приложения)', 'ООО Контрософт'],
  ['SIEM-инженер (Middle, Senior)', 'ООО Амбрелла'],
  ['Реверс-инженер (Reverse Engineer)', 'АО Квазар'],
  ['Senior Developer Go/Python', 'Лаборатория Касперского'],
  ['Go-разработчик (Middle)', 'Data Light'],
  ['Инженер по сопровождению/Support Engineer (Трайб CVM)', 'ОТП Банк. IT'],
  ['Системный администратор Linux / Junior Devops', 'Travelata.ru'],
  // повторы в компанию, с которой уже идёт диалог
  ['Тестировщик', 'Crowdtesting.ru'],
  ['Junior QA Engineer', 'Даньшин Дмитрий Владиславович'],
  ['Python-разработчик по автоматизации', 'Симикян Андраник Артурович'],
];
const allowed = [
  ['Junior Python-разработчик (FastAPI)', 'Ромашка Софт'],
  ['Python-разработчик по автоматизации', 'ООО Ромашка'],
  ['Junior QA Engineer', 'ООО Ромашка'],
  ['Стажер тестировщик QA', 'ООО Ромашка'],
  ['Тестировщик', 'ООО Ромашка'],
  ['Младший специалист по сборке Telegram-ботов и AI-сервисов (Junior / Стажер)', 'ООО Ромашка'],
  ['Python разработчик (Junior/Trainee)', 'ООО Ромашка'],
  ['Инженер по тестированию', 'ООО Ромашка'],
  ['Backend разработчик Python', 'ООО Ромашка'],
  ['Разработчик парсера на Python', 'ООО Ромашка'],
  ['DevOps-инженер (junior)', 'ООО Ромашка'],
  ['Разработчик Telegram-ботов', 'ООО Ромашка'],
  ['Инженер по автотестированию (Python)', 'IBS'],
  ['Специалист по парсингу данных', 'Adviva'],
  ['Python-разработчик / специалист по API-интеграциям маркетплейсов', 'SCorp'],
  ['Integration / AI Automation Developer — Python/API/n8n (Разработчик автоматизации)', 'ООО Мустанг'],
  ['Аналитик данных Junior', 'SDO'],
];

let bad = 0;
function check(list, expectOk) {
  for (const [t, c] of list) {
    const a = judge({ id: '222222222', title: t, co: c, remote: true, noExp: true });
    const b = jInPage({ id: '222222222', title: t, co: c, remote: true, noExp: true });
    // страничная версия отдаёт reason:" при успехе, node — свойство не ставит вовсе,
    // поэтому пустое значение нормализуем, иначе все успешные кейсы дают ложное расхождение.
    if ((a.reason || '') !== (b.reason || '') || a.rule !== b.rule) {
      bad++;
      console.log('  РАСХОЖДЕНИЕ node/страница: ' + t.slice(0, 50) + ' | node=' + JSON.stringify(a) + ' page=' + JSON.stringify(b));
      continue;
    }
    const ok = (a.reason || '') === '';
    if (ok !== expectOk) {
      bad++;
      console.log('  ' + (expectOk ? 'ЗАБЛОКИРОВАНО (ошибка): ' : 'ПРОПУЩЕН (ошибка): ') + t.slice(0, 50) + ' [' + (a.reason || 'allow#' + a.rule) + ']');
    } else {
      console.log('  ' + (ok ? 'ok  allow#' + String(a.rule).padEnd(2) : a.reason).padEnd(20) + t.slice(0, 50));
    }
  }
}
console.log('--- должны блокироваться (' + blocked.length + ') ---');
check(blocked, false);
console.log('--- должны пройти (' + allowed.length + ') ---');
check(allowed, true);
const dedup = jInPage({ id: '111111111', title: 'Python разработчик', co: 'X', remote: true, noExp: true });
if (dedup.reason !== 'alreadyApplied') { bad++; console.log('  ОЖИДАЛ alreadyApplied, получил ' + JSON.stringify(dedup)); }
else console.log('  alreadyApplied      дедуп по списку откликов');
console.log('правил: ALLOW ' + require('./hh-target.js').ALLOW.length + ', BLOCK ' + require('./hh-target.js').BLOCK.length + ', BLOCK_COMPANY ' + require('./hh-target.js').BLOCK_COMPANY.length + ', ENGAGED ' + ENGAGED_COMPANY.length + ', BLOCK_NON_IT ' + BLOCK_NON_IT.length);
console.log(bad === 0 && guard === 0 ? 'ИТОГ: node и страница согласованы, все кейсы верны, escape-последовательностей нет' : 'ИТОГ: ошибок ' + bad + ', нарушений правил ' + guard);
process.exit(bad === 0 && guard === 0 ? 0 : 1);
