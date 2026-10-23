// Откуда брать полный текст описания вакансии на hh.
//
// Проблема найдена: data-qa="vacancy-description" стоит на ВНЕШНЕМ div, и
// внутри сразу идут вложенные <div>/<meta>/<style>. Регулярка «до первого </»
// поэтому вытаскивала 7–170 символов вместо текста. Текст лежит глубже.
//
// Три источника, проверяем все:
//   1. ld+json → JobPosting.description (обычно полный HTML)
//   2. div.ght-content внутри блока описания
//   3. data-qa="vacancy-description-html"
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/\s+/g, ' ').trim();

const id = process.argv[2] || '138482417';
const r = await fetch(`https://hh.ru/vacancy/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
const t = await r.text();

let jp = {};
for (const b of t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
  try { const j = JSON.parse(b[1]); for (const node of (j['@graph'] || [j])) if (node['@type'] === 'JobPosting') jp = node; } catch { }
}
const ld = strip(jp.description || '');
console.log('1) ld+json description:', ld.length, 'символов');
console.log('   ', ld.slice(0, 300));

const ght = [...t.matchAll(/<div class="ght-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)].map(m => strip(m[1]));
console.log('2) ght-content блоков:', ght.length, '| длина первого:', ght[0] ? ght[0].length : 0);
if (ght[0]) console.log('   ', ght[0].slice(0, 300));

const htmlQa = [...t.matchAll(/data-qa="vacancy-description-html"[^>]*>([\s\S]*?)<\/div>/g)].map(m => strip(m[1]));
console.log('3) vacancy-description-html:', htmlQa.length, '| длина:', htmlQa[0] ? htmlQa[0].length : 0);
if (htmlQa[0]) console.log('   ', htmlQa[0].slice(0, 300));

// Сколько вообще символов текста на странице (грубая оценка полноты)
const body = strip(t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''));
console.log('текста на странице всего:', body.length);
console.log('ld+json покрывает описание?', body.includes(ld.slice(0, 120)));
