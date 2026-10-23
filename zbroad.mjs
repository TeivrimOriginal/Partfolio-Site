// Широкий сбор вакансий по Заречному и окрестностям.
//
// Задача: не «просто IT», а вообще всё, куда может взять 19-летнего студента
// колледжа без высшего образования. Собираем по текстовым запросам, потому что
// фильтр по отрасли на hh (area + параметр) не покрывает «частные производства»
// и «гос учреждения» — они сидят в общей ленте.
//
// Что важно в этом скрипте и почему так написано:
//
// 1. Запросы идут к hh как гостю. Гость видит меньше, чем авторизованный, но
//    выдачу по area отдаёт целиком.
// 2. Троттлинг: hh начинает отдавать 403/461 после ~70-80 запросов подряд.
//    Лечится чередованием хостов (hh.ru / zarechny.hh.ru), паузой и повторами.
//    Без этого молча теряется половина выборки.
// 3. Опыт и график берём из карточки выдачи по data-qa, а не из заголовка:
//    «Junior» в заголовке ничего не говорит про «от 2 лет» в требованиях.
//
// Запуск: node zbroad.mjs [area] [maxPagesPerQuery]
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const RETRY = [2500, 6000, 15000];
const ARGS = process.argv.slice(2);
const AREA = ARGS[0] || '1275';
const MAXPAGES = Number(ARGS[1] || 3);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();

// Направления. Слова подобраны так, чтобы попадать и в «частные производства»,
// и в «гос учреждения»: местные вакансии часто называются без отрасли
// («Менеджер», «Рабочий»), а ИТ-часть прячется в описании.
const QUERIES = [
  // --- ИТ и около ИТ ---
  'оператор ПК', 'оператор компьютера', '1С программист', '1С оператор',
  'программист', 'системный администратор', 'администратор 1С',
  'тестировщик', 'копирайт', 'компьютерщик', 'помощник руководителя',
  'печатник', 'принтер', 'заправка картриджей', 'настройка рабочих мест',
  'веб дизайнер', 'дизайнер', 'смм', 'контент менеджер', 'оператор call центра',
  'специалист поддержки', 'техник', 'инженер', 'сборщик данных', 'ввод данных',
  // --- производство и ремонт ---
  'сборщик мебели', 'рабочий', 'разнорабочий', 'упаковщик', 'комплектовщик',
  'кладовщик', 'грузчик', 'сварщик', 'электрик', 'сантехник', 'маляр',
  'плотник', 'столяр', 'сборщик', 'монтажник', 'машинист', 'токарь',
  // --- услуги и торговля ---
  'продавец', 'кассир', 'менеджер по продажам', 'торговый представитель',
  'администратор', 'официант', 'кухонный помощник', 'повар', 'бариста',
  'курьер', 'клинер', 'уборщик', 'домработница',
  // --- гос, медицина, образование ---
  'санитар', 'медсестра', 'врач', 'фельдшер', 'психолог', 'воспитатель',
  'педагог', 'тьютор', 'социальный работник', 'инспектор', 'дежурный',
  'секретарь', 'делопроизводитель', 'архивариус', 'бухгалтер', 'кассир',
  'пожарный', 'спасатель', 'водитель', 'механик', 'автомеханик',
  // --- общее ---
  'стажер', 'стажёр', 'ученик', 'без опыта', 'частичная занятость',
  'подработка', 'студент', 'гибкий график', 'свободный график',
];

async function fetchText(url) {
  for (let attempt = 0; attempt <= RETRY.length; attempt++) {
    if (attempt > 0) await sleep(RETRY[attempt - 1]);
    try {
      const r = await fetch(HOSTS[attempt % HOSTS.length] + url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      const t = await r.text();
      if (r.status === 200 && t.length > 5000) return t;
    } catch { /* retry */ }
  }
  return '';
}

function cardsOf(html) {
  const out = [];
  for (const chunk of html.split('data-qa="vacancy-serp__vacancy"').slice(1)) {
    const idm = chunk.match(/vacancy\/(\d+)[?"\/]/);
    if (!idm) continue;
    const body = chunk.slice(0, 7000);
    const ti = body.match(/data-qa="serp-item__title-text"[^>]*>([\s\S]{0,300}?)<\/span><\/span><\/span>/);
    const exp = (body.match(/work-experience-([A-Za-z0-9]+)/) || [])[1] || '';
    const sal = [...body.matchAll(/<data value="(\d+)"[^>]*>/g)].map(m => Number(m[1]));
    const emp = (body.match(/data-qa="serp-item__vacancy-employer-name"[^>]*>([\s\S]{0,200}?)<\/span>/) || [])[1];
    const city = (body.match(/data-qa="serp-item__vacancy-compensation"[^>]*>/) || [])[0];
    const text = strip(body);
    out.push({
      id: idm[1],
      title: ti ? strip(ti[1]) : '',
      employer: emp ? strip(emp) : '',
      exp,
      from: sal[0] ?? null,
      to: sal[1] ?? null,
      schedule: /work-schedule-free|flexible|гибк/i.test(text) ? 'гибкий' :
        /work-schedule-shift|сменн/i.test(text) ? 'сменный' : '',
      partTime: /частичная занятость|part-time/i.test(text),
      remote: /work-schedule-remote|удаленн/i.test(text),
      city,
      url: 'https://hh.ru/vacancy/' + idm[1],
    });
  }
  return out;
}

const seen = new Map();
const perQuery = {};
let pages = 0;

for (const q of QUERIES) {
  let got = 0;
  for (let p = 0; p < MAXPAGES; p++) {
    const html = await fetchText(`/search/vacancy?area=${AREA}&order_by=publication_time&items_on_page=50&text=${encodeURIComponent(q)}&page=${p}`);
    const cards = cardsOf(html);
    if (!cards.length) break;
    pages++; got += cards.length;
    for (const c of cards) {
      if (!seen.has(c.id)) seen.set(c.id, { ...c, queries: [q] });
      else seen.get(c.id).queries.push(q);
    }
    await sleep(700);
  }
  perQuery[q] = got;
  process.stdout.write(`[${q}] ${got}\n`);
}

const list = [...seen.values()];
fs.writeFileSync(`zbroad-area${AREA}.json`, JSON.stringify(list, null, 1), 'utf8');

const byExp = {};
for (const v of list) byExp[v.exp] = (byExp[v.exp] || 0) + 1;
console.log('\n=== area', AREA, 'уникальных вакансий:', list.length, '| страниц отдано:', pages);
console.log('по опыту:', JSON.stringify(byExp));
console.log('гибкий график:', list.filter(v => v.schedule === 'гибкий').length,
  '| сменный:', list.filter(v => v.schedule === 'сменный').length,
  '| частичная:', list.filter(v => v.partTime).length,
  '| удалёнка:', list.filter(v => v.remote).length);
console.log('без опыта:', list.filter(v => v.exp === 'noExperience').length);
console.log('сохранено -> zbroad-area' + AREA + '.json');
