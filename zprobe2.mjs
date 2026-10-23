// Проверка: чем отличается страница-троттлинг от нормальной страницы вакансии.
// Нужно, чтобы сборщик отличал «hh закрыл» от «вакансии нет».
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const id = process.argv[2] || '138482417';
const host = process.argv[3] || 'https://hh.ru';
const r = await fetch(`${host}/vacancy/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
const t = await r.text();
console.log('status', r.status, 'len', t.length);
const keys = ['ld\\+json', 'vacancy-description', 'vacancy-title', 'captcha', 'showcaptcha', 'Ой!', 'Доступ ограничен', 'blocked', 'work-schedule-by-days-text', 'working-hours-text', 'work-formats-text', 'employment-type', 'VacancyArchived', 'В архиве'];
for (const k of keys) console.log((t.match(new RegExp(k, 'i')) ? 'YES ' : 'no  ') + k);
if (process.argv[4] === 'dump') {
  const m = t.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  console.log('--- ld+json ---');
  console.log(m ? m[1].slice(0, 4000) : 'нет');
}
