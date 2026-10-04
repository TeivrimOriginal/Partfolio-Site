// Первичная проверка isWorthApplying на живых данных hh: 14 вакансий, которые
// дали отказы, и 6, которые дали собеседования. Компании в собеседованиях
// заменены на нейтральные, потому что они же теперь в ENGAGED_COMPANY —
// повторный отклик туда, где диалог уже идёт, не нужен. Проверка самого
// сериализованного пути и правил — в test-target-serialized.js.
const { isWorthApplying } = require('./hh-target.js');

const rejected = [
  ['Java разработчик/Java Developer (стажер)', 'Aston'],
  ['Системный аналитик (стажер)', 'Aston'],
  ['Java разработчик (ученик)', 'Aston'],
  ['Разработчик 1С (стажер)', 'Aston'],
  ['QA Engineer Java/Инженер-тестировщик Java (ученик)', 'Aston'],
  ['DevOps инженер (ученик)', 'Aston'],
  ['JavaScript/React разработчик (стажер)', 'Aston'],
  ['Стажер отдела информационной безопасности', 'ООО Ромашка'],
  ['Стажер технической поддержки devops', 'ООО Ромашка'],
  ['Дежурный инженер технической поддержки', 'ООО Ромашка'],
  ['Специалист технической поддержки 1С и торгового оборудования', 'ООО Ромашка'],
  ['Бизнес аналитик', 'ИП Ельмикеев'],
  ['Стажёр (Инженер по информационной безопасности)', 'ООО Ромашка'],
  ['Инженер по тестированию Java (стажер)', 'Aston'],
];
const interviews = [
  ['Младший специалист по сборке Telegram-ботов и AI-сервисов (Junior / Стажер)', 'ООО Ромашка'],
  ['Junior QA Engineer', 'ООО Ромашка'],
  ['Стажер тестировщик QA', 'ООО Ромашка'],
  ['Junior Python-разработчик (FastAPI)', 'ООО Ромашка'],
  ['Python-разработчик по автоматизации', 'ООО Ромашка'],
  ['Тестировщик', 'ООО Ромашка'],
];

let blocked = 0, passed = 0;
console.log('--- отказы (должны быть заблокированы) ---');
for (const [t, c] of rejected) {
  const r = isWorthApplying({ title: t, company: c, remote: true, noExperience: true });
  if (!r.ok) blocked++;
  console.log((r.ok ? '  ПРОПУЩЕН: ' : '  блок     ') + t.slice(0, 52) + '  [' + (r.reason || 'allow#' + r.rule) + ']');
}
console.log('--- собеседования (должны пройти) ---');
for (const [t, c] of interviews) {
  const r = isWorthApplying({ title: t, company: c, remote: true, noExperience: true });
  if (r.ok) passed++;
  console.log((r.ok ? '  ok       ' : '  ЗАБЛОКИРОВАНО: ') + t.slice(0, 52) + (r.ok ? '' : '  [' + r.reason + ']'));
}
console.log('--- компании с активным диалогом (должны быть отсеяны) ---');
for (const [t, c] of [['Тестировщик', 'Crowdtesting.ru'], ['Junior QA Engineer', 'Даньшин Дмитрий'], ['Стажер тестировщик QA', 'Солар']]) {
  const r = isWorthApplying({ title: t, company: c, remote: true, noExperience: true });
  console.log((!r.ok && r.reason === 'alreadyEngaged' ? '  ok       ' : '  ОШИБКА   ') + c + '  [' + (r.reason || 'прошёл') + ']');
  if (!r.ok && r.reason === 'alreadyEngaged') passed++;
}
const ok = blocked === rejected.length && passed === interviews.length + 3;
console.log('итого: заблокировано ' + blocked + ' из ' + rejected.length + ', прошло ' + passed + ' из ' + (interviews.length + 3));
process.exit(ok ? 0 : 1);
