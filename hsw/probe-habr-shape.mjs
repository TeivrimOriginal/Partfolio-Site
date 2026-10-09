// Разбираюсь с формой vacancies: Object.keys даёт 25 числовых ключей, но
// Object.values — 2 значения. Значит структура не та, чем кажется, и
// предположение «это массив» неверно. Смотрю на само значение.
import { readFileSync } from 'node:fs';

const t = readFileSync('hsw/probe-habr.html', 'utf8');
const j = JSON.parse(t.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/)[1]);

const v = j.vacancies;
console.log('typeof:', typeof v);
console.log('Array.isArray:', Array.isArray(v));
console.log('keys:', Object.keys(v).join(','));
console.log('Object.keys length:', Object.keys(v).length);
console.log('Object.values length:', Object.values(v).length);
console.log('v.length:', v.length);

console.log('\ntypeof по ключам:');
for (const k of Object.keys(v).slice(0, 6)) {
  console.log(`  [${k}] typeof=${typeof v[k]} ${Array.isArray(v[k]) ? 'array(' + v[k].length + ')' : ''}`);
}

console.log('\nпервые 400 символов JSON значения:');
console.log(JSON.stringify(v).slice(0, 400));