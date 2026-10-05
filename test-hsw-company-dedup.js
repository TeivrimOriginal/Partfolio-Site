// Дедупликация компаний: главная защита от второй рассылки тем же людям.
//
// Что здесь проверяется и почему каждая проверка существует. Каждая строка
// отвечает на конкретный способ, которым компания уже разъезжалась на две строки
// при обходе нескольких площадок:
//
//   1. форма и регистр:  «ООО Ромашка» / «Ромашка» / «АО «Ромашка»» / «ООО РОМАШКА»
//   2. латиница:         «Ooo Romashka» — на hh пишут латиницей, на Хабре кириллицей
//   3. перестановка:     «Ромашка, ПАО» / «ПАО Ромашка»
//   4. близкое имя:      «Yandex» / «ООО Яндекс» — транслитерация неточна, и точное
//                        совпадение их не сведёт
//   5. НЕ слипание:      «Ромашка» и «Ромашек», «Сбер» и «Сбербанк», «Яндекс» и
//                        «Яндекс Практикум» — это разные компании, и склейка здесь
//                        опаснее, чем дубль
//
// Использование: node test-hsw-company-dedup.js
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA, normCompany, upsertCompany, findCompany } = require('./hsw-db.js');

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

let bad = 0;

function group(title, names, expectRows) {
  const db = fresh();
  for (const n of names) upsertCompany(db, n, { source: 'test' });
  const rows = db.prepare('SELECT count(*) c FROM companies').get().c;
  const ok = rows === expectRows;
  console.log('  ' + (ok ? 'ок        ' : 'НЕВЕРНО  ') + title);
  console.log('             строк: ' + rows + ', ожидалось: ' + expectRows);
  if (!ok) {
    for (const r of db.prepare('SELECT name, norm FROM companies').all()) {
      console.log('             → ' + JSON.stringify(r.name) + ' / ' + JSON.stringify(r.norm));
    }
    bad++;
  }
  return db;
}

console.log('одна компарация под разными именами должна дать одну строку');
group('форма и регистр', ['ООО Ромашка', 'Ромашка', 'АО «Ромашка»', 'ООО РОМАШКА', 'Ромашка'], 1);
group('латиница', ['Ooo Romashka', 'ООО Ромашка', 'OOO Romashka'], 1);
group('перестановка формы', ['Ромашка, ПАО', 'ПАО Ромашка', 'Ромашка'], 1);
group('всё вместе', ['ООО Ромашка', 'Ромашка', 'АО «Ромашка»', 'Ooo Romashka', 'ООО РОМАШКА', 'Ромашка, ПАО', 'Pao Romashka'], 1);

console.log('');
console.log('разные компании должны остаться разными');
group('похожие, но разные', ['Ромашка', 'Ромашек', 'Ромашка Технологии', 'Ромашник'], 4);
group('разные банки', ['Сбер', 'ПАО Сбербанк', 'ООО Сбербанк Разработка', 'Тинькофф'], 4);
group('яндекс и его подразделения', ['Яндекс', 'Яндекс Практикум', 'ООО Яндекс Еда', 'Yandex Go'], 4);
// «Лаборатория Касперского» и «Kaspersky» — одна компания, но пословно они не
// совпадают: слова «лаборатория»/«касперского» против «касперский». Склеивать
// их по догадке нельзя: склейка разных компаний хуже дубля, а ложная склейка
// здесь означала бы одну рассылку вместо двух разным адресатам. Правильный
// способ свести их — домен или id на площадке, а не угадывание имени.
group('совсем разные', ['Лаборатория Касперского', 'Kaspersky', 'Miro', 'ООО Мир'], 4);

console.log('');
console.log('конкретный случай из практики: латиница против кириллицы');
{
  const db = fresh();
  const a = upsertCompany(db, 'ООО Яндекс', { source: 'hh' });
  const b = upsertCompany(db, 'Yandex', { source: 'linkedin' });
  const ok = a.id === b.id && !b.created;
  console.log('  ' + (ok ? 'ок        ' : 'НЕВЕРНО  ') + 'ООО Яндекс (hh) и Yandex (LinkedIn) → одна строка');
  console.log('             id: ' + a.id + ' и ' + b.id + ', вторая вставка создала новую: ' + b.created);
  if (!ok) bad++;
}

console.log('');
console.log('поля компании заполняются при повторной встрече');
{
  const db = fresh();
  const a = upsertCompany(db, 'ООО Ромашка', { source: 'hh' });
  const b = upsertCompany(db, 'ООО Ромашка', { hh_id: '12345', city: 'Екатеринбург', site: 'romashka.ru' });
  const row = db.prepare('SELECT * FROM companies WHERE id = ?').get(a.id);
  const ok = row.hh_id === '12345' && row.city === 'Екатеринбург' && row.site === 'romashka.ru';
  console.log('  ' + (ok ? 'ок        ' : 'НЕВЕРНО  ') + 'появились hh_id, city, site');
  console.log('             ' + JSON.stringify({ hh_id: row.hh_id, city: row.city, site: row.site }));
  if (!ok) bad++;
}

console.log('');
console.log('полные контакты помечаются, чтобы не собирать их дважды');
{
  const db = fresh();
  const c = upsertCompany(db, 'ООО Ромашка', { source: 'hh' });
  const q1 = db.prepare('SELECT count(*) c FROM companies WHERE fully_collected = 0').get().c;
  db.prepare('UPDATE companies SET fully_collected = 1 WHERE id = ?').run(c.id);
  const q2 = db.prepare('SELECT count(*) c FROM companies WHERE fully_collected = 0').get().c;
  const ok = q1 === 1 && q2 === 0;
  console.log('  ' + (ok ? 'ок        ' : 'НЕВЕРНО  ') + 'fully_collected отражает состояние');
  console.log('             ждут сбора: ' + q1 + ' → ' + q2);
  if (!ok) bad++;
}

console.log('');
console.log('findCompany ничего не находит на пустой базе и не падает');
{
  const db = fresh();
  const r = findCompany(db, 'ООО Никого Нет');
  const ok = r === null;
  console.log('  ' + (ok ? 'ок        ' : 'НЕВЕРНО  ') + 'пустая база');
  if (!ok) bad++;
}

console.log('');
console.log('ошибок: ' + bad);
process.exit(bad === 0 ? 0 : 1);
