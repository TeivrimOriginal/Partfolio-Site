// Как на самом деле устроен блок описания вакансии на hh: сколько вложенных
// тегов и где кончается текст. Нужно, чтобы вытаскивать описание целиком,
// а не первые 7 символов.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
import fs from 'node:fs';
const id = process.argv[2] || '138482417';
const r = await fetch(`https://hh.ru/vacancy/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
const t = await r.text();
fs.writeFileSync('F:/tmp/opencode/vac.html', t, 'utf8');
const i = t.indexOf('vacancy-description');
console.log('index', i, 'len', t.length);
console.log('--- 2500 символов от data-qa="vacancy-description" ---');
console.log(t.slice(i - 200, i + 2500));
