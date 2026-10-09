// Проверяю, что отдают Хабр Карьера и Hirify FL гостю и по какому адресу,
// прежде чем писать сборщик. Обе площадки разные по устройству: у Хабра
// SPA с JSON внутри страницы, у Hirify — обычный HTML.
import { writeFileSync as write } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(name, url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9', Accept: 'text/html,application/json' },
      redirect: 'follow',
    });
    const t = await r.text();
    console.log(`\n=== ${name}`);
    console.log(`  status ${r.status} · len ${t.length} · final ${r.url}`);
    const marks = {
      'script ld+json': /application\/ld\+json/i.test(t),
      'window.__INITIAL': /__INITIAL_STATE__|__NUXT__|__NEXT_DATA__|data-state=/i.test(t),
      'вакансия/словo': /ваканси/i.test(t),
      'требуется высшее': /высш(ее|его)\s+образован/i.test(t),
      'remote/удаленно': /удалённ|удаленн|remote/i.test(t),
      'без опыта': /без опыта|нет опыта|опыта не требуется/i.test(t),
    };
    for (const [k, v] of Object.entries(marks)) console.log(`  ${v ? '+' : '-'} ${k}`);
    const ids = [...new Set([...t.matchAll(/\/vacanc(?:y|ies)\/(\d+)/g)].map((m) => m[1]))];
    console.log(`  id вакансий по /vacancy/<id>: ${ids.length} ${ids.slice(0, 5).join(',')}`);
    const hrefs = [...new Set([...t.matchAll(/href="(https?:\/\/career\.habr\.com\/vacancies\/[^"]+)"/g)].map((m) => m[1]))];
    console.log(`  ссылок career.habr.com/vacancies: ${hrefs.length} ${hrefs.slice(0, 3).join(' ')}`);
    return t;
  } catch (e) {
    console.log(`\n=== ${name}\n  ОШИБКА ${e.cause?.code || e.message}`);
    return '';
  }
}

const habr = await probe('Хабр Карьера, список', 'https://career.habr.com/vacancies');
if (habr) {
  const i = habr.search(/window\.__[A-Z_]+__/);
  console.log('  первое window.__*:', i < 0 ? 'нет' : habr.slice(i, i + 40).replace(/\s+/g, ' '));
  write('hsw/probe-habr.html', habr);
}
const hirify = await probe('Hirify FL', 'https://www.hirify.ru/vacancy');
if (hirify) write('hsw/probe-hirify.html', hirify);