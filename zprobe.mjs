// Проба сырой разметки карточки выдачи hh: какие data-qa вообще есть.
// Нужно, чтобы брать график/занятость из карточки, а не из заголовка.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const q = process.argv[2] || 'оператор ПК';
const area = process.argv[3] || '1275';
const r = await fetch(`https://hh.ru/search/vacancy?area=${area}&text=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA } });
const t = await r.text();
const chunk = t.split('data-qa="vacancy-serp__vacancy"')[1] || '';
console.log('len chunk', chunk.length);
const qas = [...new Set([...chunk.matchAll(/data-qa="([^"]+)"/g)].map(m => m[1]))];
console.log(qas.join('\n'));
console.log('--- snippet ---');
console.log(chunk.slice(0, 3000));
