// Сбор цитат из описаний вакансий для сопроводительных писем.
//
// Зачем это отдельный скрипт. Цитаты нужны, чтобы письмо отвечало на
// требования конкретной вакансии, а не звучало шаблоном. Раньше цитаты
// собирались вручную внутри страницы браузера, каждый раз заново и с
// опечатками в селекторах.
//
// Две особенности реальных описаний, из-за которых нужны запасные ходы:
//   1. Часто нет знаков препинания внутри списка требований: «разработка и
//      сопровождение desktop приложений, а так же серверных модулей (backend),
//      в том числе web-сервисов и API (REST, gRPC, WebSocket) на Python 3» —
//      это один кусок на 200 знаков. Если резать только по точкам, цитат не
//      будет вообще, и письмо станет шаблонным.
//   2. Первое предложение часто рекламное («компания работает с 1997 года»).
//      Цитировать его в письме бессмысленно.
//
// Скрипт печатает найденные цитаты в формате, готовом для строки в
// hh-shortlist-data-*.json, и проверяет, что ни одна из них не повторяет
// заголовок вакансии.
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const MIN_LEN = 30;
const MAX_LEN = 165;
const MAX_SENTS = 4;

// Что цтитировать полезно.
const RE_USEFUL = /нужно|необходимо|требуется|обязан|разрабатыва|разработк|пишем|работа с|работать с|знание|знания|опыт|умение|понимание|docker|postgresql|linux|ci|тест|api|rest|soap|grpc|websocket|sql|rabbit|очеред|логир|требован|ждем|ждём|задач|ваканси|интеграц|деплой|асинхрон/i;
// Что цитировать нельзя.
const RE_JUNK = /высшее|среднее|образован|стаж|зп|з\/п|оформлен|бенефит|питани|команд|офис|переезд|договор|топ-|входит в|численность|работаем на рынке/i;
// Рекламные обороты: описывают компанию, а не задачу.
const RE_ADS = /с 19|основан|один из ведущих|один из крупнейших|лидер|входит в топ|численность сотрудников|itti/i;

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&quot;/g, '"'], [/&#39;/g, "'"],
  [/&laquo;/g, '«'], [/&raquo;/g, '»'], [/&mdash;/g, '—'], [/&ndash;/g, '–'],
  [/&lt;/g, '<'], [/&gt;/g, '>'],
];

function htmlToText(html) {
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|li|div|h[1-6]|tr|span)>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENTITIES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function descriptionOf(html) {
  const open = html.indexOf('data-qa="vacancy-description"');
  if (open < 0) return '';
  const start = html.indexOf('>', open);
  if (start < 0) return '';
  const close = html.indexOf('data-qa="vacancy-description-next"', start);
  return htmlToText(html.slice(start, close > 0 ? close : Math.min(html.length, start + 60000)));
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();
}

// Кандидаты на цитату: сначала по точкам и двоеточиям, если пусто — по запятым.
//
// Разбиение по запятым требует накопления, а не простого отрезания. В
// «web-сервисов и API (REST, gRPC, WebSocket) на Python 3» короткое «gRPC»
// выпадает по длине, и получаются цитаты «в том числе web-сервисов и API
// (REST» и «WebSocket) на Python 3…» — в письме это выглядит как мусор.
// Поэтому части собираются обратно: идём по запятым, копим до 45 знаков и
// проверяем получившийся кусок целиком.
const CHUNK_MIN = 45;

function chunkCommas(parts) {
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    const next = cur ? cur + ', ' + p : p;
    if (next.length > MAX_LEN) {
      if (cur.length >= CHUNK_MIN) chunks.push(cur);
      cur = p;
    } else {
      cur = next;
      if (cur.length >= CHUNK_MIN) { chunks.push(cur); cur = ''; }
    }
  }
  if (cur.length >= CHUNK_MIN) chunks.push(cur);
  return chunks;
}

function splitCandidates(desc) {
  const bySentence = desc.split(/\n+|(?<=[.!?;:•])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = bySentence.filter((s) => s.length >= MIN_LEN && s.length <= MAX_LEN);
  if (kept.length) return { sents: kept, mode: 'по точкам' };
  const byComma = desc.split(/,\s+|;\s+/).map((s) => s.trim()).filter(Boolean);
  return { sents: chunkCommas(byComma), mode: 'по запятым с накоплением' };
}

// Кусок цитаты должен начинаться на границе фразы: с заглавной буквы либо с
// одного из слов, с которых начинается пункт обязанностей. Иначе в письме
// появляются обрывки вида «WebSocket) на Python 3…».
//
// Проверки раздельные намеренно: с общим флагом i диапазон [А-ЯЁ] в JS
// растягивается на строчные, и условие проходило для любого начала фразы —
// то есть не проверяло ничего.
const RE_STARTER_CAP = /^[А-ЯЁA-Z]/;
const RE_STARTER_VERB = /^(участие|разработка|отладка|помощь|знание|знания|понимание|опыт|написание|сопровождение|разв[её]тывание|поддержка|проектирование|внедрение|автоматизац|создание|тестирование|проведение|анализ|мониторинг|настройка|взаимодействие|работа)/i;
function startsOk(p) {
  if (RE_STARTER_CAP.test(p) || RE_STARTER_VERB.test(p)) {
    // Скобка закрывается раньше, чем открывается: значит кусок начался
    // с середины перечисления и в письме прочитается как «WebSocket) на
    // Python 3…» или «Redis, RabbitMQ, Kafka) и ПО…».
    return !/^[^(]*\)/.test(p);
  }
  return false;
}

function harvest(desc, title) {
  const normTitle = normalize(title);
  const { sents, mode } = splitCandidates(desc);
  const out = [];
  for (const raw of sents) {
    if (out.length >= MAX_SENTS) break;
    const p = raw.replace(/^[-–—•*\s]+/, '').replace(/[.;:]+$/, '').trim();
    if (RE_JUNK.test(p)) continue;
    if (!RE_USEFUL.test(p)) continue;
    if (RE_ADS.test(p) && !/тест|api|sql|разработ/i.test(p)) continue;
    if (!startsOk(p)) continue;
    const norm = normalize(p);
    if (norm === normTitle || normTitle.indexOf(norm) === 0 || norm.indexOf(normTitle) === 0) continue;
    if (out.some((x) => normalize(x) === norm)) continue;
    out.push(p);
  }
  return { sents: out, mode: mode };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url, id) {
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await sleep([2000, 5000, 12000][attempt - 1]);
    try {
      const r = await fetch(HOSTS[attempt % HOSTS.length] + url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
      if (!r.ok) continue;
      const t = await r.text();
      if (t.length > 5000) return t;
    } catch (e) { /* следующий хост */ }
  }
  throw new Error(id + ': страница не пришла');
}

(async function () {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.log('передай id: node harvest-requirements.js 136856840 136597663');
    process.exit(1);
  }
  const items = [];
  for (const id of ids) {
    const html = await fetchHtml('/vacancy/' + id, id);
    const desc = descriptionOf(html);
    if (!desc) { console.log(id + ': описание не нашлось'); continue; }
    const titleM = html.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/);
    const title = titleM ? htmlToText(titleM[1]) : '';
    const hasApply = /data-qa="vacancy-response-link-top"/.test(html);
    const { sents, mode } = harvest(desc, title);
    items.push({ id: id, sents: sents });
    console.log('=== ' + id + ' ' + title.slice(0, 44) + ' (описание ' + desc.length + ' знаков, резали ' + mode + ')');
    console.log('    кнопка отклика: ' + (hasApply ? 'есть' : 'НЕТ'));
    for (const s of sents) console.log('    - ' + s);
    if (!sents.length) console.log('    цитат нет');
    await sleep(700);
  }
  console.log('\nготово для вставки в hh-shortlist-data-b5.json:');
  console.log(JSON.stringify({ _comment: 'собрано harvest-requirements.js', items: items }, null, 2));
  fs.writeFileSync(path.join(__dirname, 'hh-requirements-latest.json'), JSON.stringify({ items: items }, null, 1) + '\n', 'utf8');
})().catch((e) => {
  console.log('сбор цитат упал: ' + (e && e.message));
  process.exit(1);
});