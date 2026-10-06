// Проверяет habr-page.js на сохранённых ответах Хабра.
//
// Формат ответа проверен на файлах, а не на живом ответе: разбор должен быть
// отделим от сети, иначе каждый прогон зависит от того, что площадка жива.
// Отдельно проверяется то, что молча ломает сборщик целиком: разбор заголовка
// с кавычками и скобками внутри названия, и разрез описания по вложенным div.

const fs = require('fs');
const habr = require('./habr-page.js');

const RSS = 'F:/tmp/habr-rss.xml';
const PAGE = 'F:/tmp/habr-vacancy.html';

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log('  ок   ' + label);
  else { console.log('  ПРОВАЛ ' + label + (detail ? '  — ' + detail : '')); failures++; }
}

if (!fs.existsSync(RSS) || !fs.existsSync(PAGE)) {
  console.log('нет сохранённых ответов: нужны F:/tmp/habr-rss.xml и F:/tmp/habr-vacancy.html');
  process.exit(2);
}

const rssXml = fs.readFileSync(RSS, 'utf8');
const pageHtml = fs.readFileSync(PAGE, 'utf8');

console.log('=== RSS ===');
const items = habr.parseRss(rssXml);
console.log('  разобрано вакансий: ' + items.length);
check('разбор дал вакансии', items.length > 0, 'получено ' + items.length);
check('у всех есть номер', items.every((i) => /^\d+$/.test(i.id)));
check('у всех есть заголовок', items.every((i) => i.title && i.title.length > 3));
check('у всех есть компания', items.every((i) => i.company && i.company.length > 1),
  items.filter((i) => !i.company).slice(0, 2).map((i) => i.id).join(','));

const withRemote = items.filter((i) => i.remoteFromFeed);
const withLevel = items.filter((i) => i.level);
console.log('  с пометкой удалённой: ' + withRemote.length + ' из ' + items.length);
console.log('  с тегом уровня:       ' + withLevel.length + ' из ' + items.length);
console.log('  пример: ' + JSON.stringify({
  id: items[0].id, title: items[0].title, city: items[0].city,
  company: items[0].company, level: items[0].level, tags: items[0].tags.slice(0, 5),
  remote: items[0].remoteFromFeed,
}, null, 0).slice(0, 240));

check('хотя бы одна вакансия помечена удалённой', withRemote.length > 0);
const levelsList = items.filter((i) => i.level).map((i) => i.level);
// Первая версия считала уровнем tags[0]. Проверяем ОБРАТНОЕ: первый тег не
// должен попадать в уровень, если он не из списка. У «DevOps Engineer (KORM)»
// первый тег — DevOps, и раньше он попадал в уровни.
check('первый тег не выдаётся за уровень без проверки списка',
  items.every((i) => !i.level || !/^(devops|linux|docker|sql|python|git|kubernetes)/i.test(i.level)),
  levelsList.filter((l) => /devops|linux|docker|sql|python/i.test(l)).join(', '));
check('уровень — только из закрытого списка', items.every((i) => {
  if (!i.level) return true;
  return /^(intern|internship|junior|trainee|train|student|стажёр|стажер|стажировка|middle|senior|lead|principal|expert|head|director|тимлид)$/i.test(i.level);
}), levelsList.slice(0, 4).join(', '));
check('в стековые теги не попал уровень', items.every((i) => !i.stackTags.includes('middle') && !i.stackTags.includes('junior') && !i.stackTags.includes('intern')));

// Уровень должен быть распознаваемым: ТЗ требует intern/junior, а #middle — это
// отказ. Проверяем, что уровень вообще вытаскивается, а не пуст у всех.
const levels = new Set(items.map((i) => i.level).filter(Boolean));
console.log('  встречающиеся уровни: ' + [...levels].join(', '));
check('уровни разнообразны (разбор не выдаёт одно и то же)', levels.size >= 1);
console.log('  вакансий с уровнем junior/intern: ' + items.filter((i) => /junior|intern|стаж/i.test(i.level)).length);

// Заголовок с кавычками и скобками внутри — частая форма на Хабре.
console.log('\n=== заголовок с кавычками и скобками ===');
const t1 = habr.splitRssTitle('Требуется «ML-инженер (Python · PyTorch · fine-tuning )» (Москва)');
console.log('  ' + JSON.stringify(t1));
check('название без города', t1.title === 'ML-инженер (Python · PyTorch · fine-tuning )', t1.title);
check('город вытащен', t1.city === 'Москва', t1.city);

const t2 = habr.splitRssTitle('Требуется «Python backend» (Москва, от 230 000 ₽)');
console.log('  ' + JSON.stringify(t2));
check('название без хвоста с зарплатой', t2.title === 'Python backend', t2.title);
check('хвост с зарплатой не попал в город', !/₽/.test(t2.city), t2.city);

console.log('\n=== сводка требований ===');
const sum = habr.parseRssSummary('Компания «Урал Логистика» ищет хорошего специалиста на вакансию «ML-инженер». Москва (Россия). Полный рабочий день. Можно удалённо. Требуемые навыки: #middle, #Машинноеобучение, #Linux, #PyTorch, #Python, #SQL.');
console.log('  ' + JSON.stringify(sum).slice(0, 260));
check('компания извлечена', sum.company === 'Урал Логистика', sum.company);
check('удалённость распознана', sum.remote === true);
check('уровень middle извлечён', sum.level === 'middle', sum.level);
check('стековые теги отделены от уровня', sum.stackTags.includes('Python'), JSON.stringify(sum.stackTags));

console.log('\n=== страница вакансии ===');
const v = habr.parseVacancyPage(pageHtml);
console.log('  заголовок: ' + v.title.slice(0, 70));
console.log('  компания:  ' + v.company);
console.log('  описание:  ' + v.description.length + ' символов');
console.log('  начало:    ' + v.description.slice(0, 120));
console.log('  закрыта:   ' + v.closed + ', нужен вход: ' + v.needLogin);
check('заголовок извлечён', v.title.length > 3);
check('компания извлечена', v.company.length > 1);
check('описание не пустое и не обрезано', v.description.length > 300, String(v.description.length));
check('описание содержит абзацы, а не первый <div>', !/^<[a-z]/i.test(v.description));
check('страница не помечена закрытой', v.closed === false);
// Ключевой факт: заглушка входа есть, но описание доступно. Если это перестанет
// быть так, сборщик должен упасть на проверке, а не молча писать пустые описания.
check('гость видит описание, хотя кнопка отклика заменена', v.description.length > 300 && v.needLogin === true);

console.log('\n=== итог ===');
console.log(failures === 0 ? 'все проверки пройдены' : 'провалов: ' + failures);
process.exitCode = failures === 0 ? 0 : 1;