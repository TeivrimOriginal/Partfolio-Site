// Ключ vacancies в JSON Хабра — это то, что нужно. Смотрим форму карточек и
// решаем, годится ли площадка под фильтр «удалённо + без опыта + без высшего».
import { readFileSync } from 'node:fs';

const t = readFileSync('hsw/probe-habr.html', 'utf8');
const j = JSON.parse(t.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/)[1]);

const v = j.vacancies;
console.log('тип vacancies:', Array.isArray(v) ? `массив из ${v.length}` : typeof v);
const list = Array.isArray(v) ? v : Object.values(v || {});
console.log('карточек:', list.length);
if (list.length) {
  console.log('\nключи карточки:', Object.keys(list[0]).join(', '));
  console.log('\nпервая карточка целиком:');
  console.log(JSON.stringify(list[0], null, 1).slice(0, 1600));
}