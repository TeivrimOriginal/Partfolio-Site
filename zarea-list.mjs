// Соседние с Заречным пункты: hh-выдача по area «Свердловская область»
// указывает в описании, где именно работа. Нужны id городов в радиусе
// досягаемости, потому что половина «заречных» вакансий — это Белоярский,
// Каменск, Арамиль и соседи.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
import fs from 'node:fs';
const r = await fetch('https://api.hh.ru/areas/1261', { headers: { 'User-Agent': UA } });
const j = await r.json();
const lines = j.areas.map(a => `${a.id} | ${a.name}`);
fs.writeFileSync('zareas-1261.txt', lines.join('\n'), 'utf8');
const WANT = ['Заречн', 'Белоярск', 'Арамил', 'Сысерт', 'Каменск', 'Богданович', 'Косулино', 'Дегтярск', 'Камышлов', 'Аббат', 'Подварк', 'Пролетарск', 'Калинов', 'Бобровский', 'Барановск'];
console.log(lines.filter(l => WANT.some(w => l.includes(w))).join('\n'));
console.log('всего', lines.length, '-> zareas-1261.txt');
