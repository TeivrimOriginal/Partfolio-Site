// В JSON Хабра ищем те же поля, что нужны фильтру: зарплата, формат, опыт.
// Без них площадка не годится — собирать заголовки бессмысленно.
import { readFileSync } from 'node:fs';

const t = readFileSync('hsw/probe-habr.html', 'utf8');
const block = t.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/)[1];
const j = JSON.parse(block);

console.log('верхний уровень:', Object.keys(j).join(', '));

// Ищем массивы, похожие на список вакансий, глубже по дереву.
function walk(node, path = '', depth = 0, out = []) {
  if (depth > 4 || !node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0]) {
      out.push({ path: p, len: v.length, keys: Object.keys(v[0]).slice(0, 14) });
    }
    if (typeof v === 'object') walk(v, p, depth + 1, out);
  }
  return out;
}

const arrays = walk(j);
console.log('\nмассивы объектов:');
for (const a of arrays.slice(0, 12)) {
  console.log(`  ${a.path} · ${a.len} · ${a.keys.join(', ').slice(0, 120)}`);
}

console.log('\nfiltersData:', JSON.stringify(j.filtersData || {}).slice(0, 700));