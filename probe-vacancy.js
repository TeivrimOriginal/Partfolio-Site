// Разведка по кандидату: кто работодатель и что в описании.
// Нужно перед тем, как добавлять в очередь: в карточке выдачи название
// компании не всегда парсится, а вакансия без работодателя в письме
// выглядит неубедительно.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const IDS = process.argv.slice(2);
if (!IDS.length) {
  console.log('передай id: node probe-vacancy.js 136856840');
  process.exit(1);
}

const ENT = [[/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&laquo;/g, '«'], [/&raquo;/g, '»'], [/&mdash;/g, '—'], [/&ndash;/g, '–']];
function text(h) {
  let t = String(h).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|li|div|h[1-6])>/gi, ' ').replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENT) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

(async function () {
  for (const id of IDS) {
    const r = await fetch('https://hh.ru/vacancy/' + id, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
    const h = await r.text();
    const t = text((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    const co = text((h.match(/data-qa="vacancy-employer-name"[^>]*>([\s\S]{0,200}?)</) || [])[1] || '')
      || text((h.match(/data-qa="employer-name"[^>]*>([\s\S]{0,200}?)</) || [])[1] || '');
    const o = h.indexOf('data-qa="vacancy-description"');
    const s = o >= 0 ? h.indexOf('>', o) + 1 : 0;
    const e = h.indexOf('data-qa="vacancy-description-next"', s);
    const desc = s > 0 ? text(h.slice(s, e > 0 ? e : s + 60000)) : '';
    console.log('=== ' + id + ' ===');
    console.log('  страница: ' + t.slice(0, 110));
    console.log('  работодатель: ' + (co || 'НЕ НАЙДЕН'));
    console.log('  кнопка: ' + (h.indexOf('data-qa="vacancy-response-link-top"') >= 0 ? 'есть' : 'НЕТ'));
    console.log('  описание: ' + desc.length + ' знаков');
    console.log('  ' + desc.slice(0, 700));
  }
})();