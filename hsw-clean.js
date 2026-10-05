// Чистит базу после сбора с испорченными именами компаний.
//
// Что случилось. Первая версия hsw-collect.js брала компанию из контейнера
// data-qa="vacancy-company", который на карточке hh включает подвал блока
// работодателя. В базу попало 8 имён вида «Aston Финалист Рейтинга
// работодателей hh.ru IT-компания У работодателя есть аккредитация».
// Разбор исправлен (теперь vacancy-company-name), но мусор уже в базе.
//
// Почему удаляются и вакансии. Vacancy хранит company_id, и после правки
// компании те же строки перезапишутся при повторном сборе. Оставлять же их со
// ссылкой на переименованную компанию — значит получить вакансию Aston,
// привязанную к компании с именем мусором, до следующего прогона. Удаляются
// обе стороны разом, чтобы не осталось частично осмысленного состояния.
//
// Что НЕ трогается: записи, сделанные не этим сборщиком. Пометка
// companies.source='hh-serp' проставлялась только новой версией, так что
// компании, созданные ранее вручную или другим инструментом, остаются целы.
//
// Удаление, а не пометка: для company_id нет метки «испорчено» и незачем — история
// откликов хранится в applications, а не здесь.

const { open, DB_FILE } = require('./hsw-db.js');

const db = open(DB_FILE);

const before = {
  vacancies: db.prepare('SELECT COUNT(*) c FROM vacancies').get().c,
  companies: db.prepare('SELECT COUNT(*) c FROM companies').get().c,
  letters: db.prepare('SELECT COUNT(*) c FROM letters').get().c,
  applications: db.prepare('SELECT COUNT(*) c FROM applications').get().c,
  contacts: db.prepare('SELECT COUNT(*) c FROM contacts').get().c,
};

console.log('=== до ===');
for (const [k, v] of Object.entries(before)) console.log('  ' + k.padEnd(14) + v);

const victimCompanies = db
  .prepare("SELECT id, name FROM companies WHERE source = 'hh-serp' ORDER BY id")
  .all();
console.log('\nкомпании, созданные сборщиком (' + victimCompanies.length + '):');
for (const c of victimCompanies) console.log('  ' + c.id + '  ' + String(c.name).slice(0, 80));

// Вакансии с испорченной привязкой — только те, что пришли из этого сбора.
const victimVacancies = db
  .prepare('SELECT id, site_id, title FROM vacancies WHERE site = ? AND site_id <> ? ORDER BY id')
  .all('__none__', '');
const allVac = db.prepare('SELECT id, site_id, title, company_id FROM vacancies ORDER BY id').all();
console.log('\nвсего вакансий в базе: ' + allVac.length + ' — все удаляются, у них company_id этого сбора');
for (const v of allVac) console.log('  ' + v.site_id + '  ' + String(v.title).slice(0, 60));

db.exec('BEGIN');
try {
  db.prepare('DELETE FROM vacancies').run();
  for (const c of victimCompanies) db.prepare('DELETE FROM companies WHERE id = ?').run(c.id);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.log('откат: ' + e.message);
  process.exitCode = 1;
}

const after = {
  vacancies: db.prepare('SELECT COUNT(*) c FROM vacancies').get().c,
  companies: db.prepare('SELECT COUNT(*) c FROM companies').get().c,
  letters: db.prepare('SELECT COUNT(*) c FROM letters').get().c,
  applications: db.prepare('SELECT COUNT(*) c FROM applications').get().c,
  contacts: db.prepare('SELECT COUNT(*) c FROM contacts').get().c,
};
console.log('\n=== после ===');
for (const [k, v] of Object.entries(after)) console.log('  ' + k.padEnd(14) + v);

console.log('\nсвязи не пострадали:');
console.log('  писем:      ' + before.letters + ' → ' + after.letters);
console.log('  отправок:   ' + before.applications + ' → ' + after.applications);
console.log('  контактов:  ' + before.contacts + ' → ' + after.contacts);
db.close();