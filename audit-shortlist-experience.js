// Аудит шорт-листа по правилу опыта.
//
// Зачем он нужен. Первые две партии вакансий отбирались глазами по заголовкам
// и по нескольким собранным предложениям. Правило опыта появилось позже и
// сразу нашло в уже стоящих в очереди вакансиях пункты, которые закрыть
// нельзя: «коммерческий опыт с FastAPI», «от 6 месяцев коммерческого опыта
// автоматизированного тестирования», «опыт в тестировании от 4 лет».
// Отклик на такую вакансию — это отказ по первому же пункту.
//
// Описания тянутся обычным запросом без cookies: hh отдаёт страницу вакансии
// гостю, проверено на 137539010 (200, описание на месте). Это значит, что аудит
// не зависит ни от входа в аккаунт, ни от браузера, и его можно повторить.
//
// Скрипт ничего не отправляет и ничего не меняет в шорт-листе: он только
// печатает отчёт и пишет его в hh-experience-audit.json. Решение по каждой
// строке принимается человеком и попадает в hh-shortlist-drop.js с цитатой.
const fs = require('fs');
const path = require('path');
const list = require('./hh-shortlist.js');
const drop = require('./hh-shortlist-drop.js');
const { reasonIn, MONTH_THRESHOLD } = require('./hh-experience.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const HOST = HOSTS[0];
const CONCURRENCY = 2;
// hh перестаёт отдавать описание примерно после 70–80 запросов подряд: страница
// приходит, но вместо текста вакансии в ней заглушка. На первом прогоне так
// отвалились 46 вакансий из 125. Поэтому ниже темп ниже, а на пустом
// описании делается до трёх повторов с нарастающей паузой.
const PAUSE_MS = 700;
const RETRY_PAUSES = [2500, 6000, 15000];

const ENTITIES = [
  [/&nbsp;/g, ' '], [/&amp;/g, '&'], [/&quot;/g, '"'], [/&#39;/g, "'"],
  [/&laquo;/g, '«'], [/&raquo;/g, '»'], [/&mdash;/g, '—'], [/&ndash;/g, '–'],
  [/&lt;/g, '<'], [/&gt;/g, '>'], [/&#x2F;/g, '/'],
];

function htmlToText(html) {
  let t = String(html);
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = t.replace(/<\/(p|li|div|h[1-6]|tr)>/gi, ' ');
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
  const slice = html.slice(start, close > 0 ? close : Math.min(html.length, start + 60000));
  return htmlToText(slice);
}

// Закрыта ли вакансия и принимает ли она отклик прямо сейчас.
// Отклик в закрытую или снятую вакансию — это потраченный слот в очереди,
// поэтому проверка идёт по каждой вакансии, а не по памяти.
//
// Первая версия искала слова «Вакансия закрыта» и «Вы откликнулись» по всему
// HTML и объявила закрытыми все 125 вакансий подряд: эти строки лежат в
// бандлах и в разметке шаблонов hh на каждой странице, включая открытые.
// Признак берётся из самой кнопки отклика и только из неё.
function stateOf(html) {
  const i = html.indexOf('data-qa="vacancy-response-link-top"');
  if (i < 0) return { known: false, closed: false, hasApply: false, label: '', alreadyApplied: false };
  // Текст кнопки берём после закрывающего «>» самой ссылки: иначе в надпись
  // попадает кусок разметки с атрибутом, как это и случилось в первой версии.
  const open = html.indexOf('>', i);
  const rest = html.slice(open + 1, open + 500);
  const nextA = rest.indexOf('<');
  const label = htmlToText(nextA > 0 ? rest.slice(0, nextA) : rest).slice(0, 60);
  return {
    known: true,
    closed: false,
    hasApply: true,
    label: label,
    alreadyApplied: /отклик отправлен|вы откликнулись|отклик получен/i.test(label),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const rows = [];
  const errors = [];
  const droppedIds = drop.map((d) => d.id);
  const protectedIds = (drop.KEEP_NOT_DROPPED || []).map((d) => d.id);

  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const v = list[cursor++];
      try {
        let desc = '';
        let lastStatus = 0;
        let state = null;
        for (let attempt = 0; attempt <= RETRY_PAUSES.length; attempt++) {
          if (attempt > 0) await sleep(RETRY_PAUSES[attempt - 1]);
          // Повторы идут на другой хост: hh смотрит лимит на источник, и смена
          // hh.ru на zarechny.hh.ru заметно снижает число заглушек.
          const host = attempt % 2 === 0 ? HOST : HOSTS[1];
          const r = await fetch(host + '/vacancy/' + v.id, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9' } });
          lastStatus = r.status;
          if (!r.ok) continue;
          const html = await r.text();
          state = stateOf(html);
          desc = descriptionOf(html);
          if (desc) break;
        }
        if (!desc && !state) { errors.push(v.id + ': описание не пришло (HTTP ' + lastStatus + ') даже после повторов'); continue; }
        if (!desc) { errors.push(v.id + ': описание не пришло (HTTP ' + lastStatus + ')'); }
        const why = desc ? reasonIn(desc) : null;
        // Признак закрытой вакансии — только отсутствие кнопки отклика.
// Строки «Вакансия закрыта» и «Вакансия не актуальна» искать нельзя: они есть
// в бандлах и шаблонах hh на каждой странице, включая открытые вакансии, и
// такая проверка объявляла закрытыми все 51 сразу.
const closed = desc ? !state.hasApply : null;
        rows.push({
          id: v.id, title: v.title, company: v.co, descLen: desc ? desc.length : 0,
          rule: why ? why.rule : '', matched: why ? why.matched : '',
          months: why && why.months ? why.months : 0,
          context: why ? why.context : '',
          closed: closed, hasApply: state.hasApply, alreadyApplied: state.alreadyApplied, label: state.label,
          alreadyDropped: droppedIds.indexOf(v.id) >= 0,
          protected: protectedIds.indexOf(v.id) >= 0,
        });
      } catch (e) {
        errors.push(v.id + ': ' + (e && e.message));
      }
      await sleep(PAUSE_MS);
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  const bad = rows.filter((r) => r.rule && !r.alreadyDropped && !r.protected);
  const falsePositives = rows.filter((r) => r.rule && r.protected);
  const missedDrops = rows.filter((r) => !r.rule && r.alreadyDropped);
  // Очередь — это не список id, а список вакансий, куда ещё можно откликнуться.
  // Закрытая или снятая вакансия занимает место в очереди и не даёт отклика,
  // поэтому её надо видеть до отправки, а не после.
  const notOpen = rows.filter((r) => !r.alreadyDropped && r.closed === true);

  const report = {
    generated: new Date().toISOString().slice(0, 10),
    thresholdMonths: MONTH_THRESHOLD,
    checked: rows.length,
    errors: errors,
    violations: bad,
    falsePositives: falsePositives,
    dropsNoLongerNeeded: missedDrops,
    notOpen: notOpen.map((r) => ({ id: r.id, title: r.title, company: r.company, closed: r.closed, hasApply: r.hasApply })),
    alreadyAppliedDetected: rows.filter((r) => r.alreadyApplied).map((r) => r.id),
  };
  fs.writeFileSync(path.join(__dirname, 'hh-experience-audit.json'), JSON.stringify(report, null, 1) + '\n', 'utf8');

  console.log('проверено: ' + rows.length + ' из ' + list.length + ', ошибок: ' + errors.length);
  for (const e of errors) console.log('  ошибка ' + e);
  console.log('нарушений, которые ещё не в отсеве: ' + bad.length);
  for (const r of bad) {
    console.log('  ' + r.id + ' | ' + r.rule + (r.months ? ' ' + r.months + ' мес' : '') + ' | ' + r.title.slice(0, 40) + ' | ' + (r.company || '').slice(0, 26));
    console.log('      ' + r.context.slice(0, 150));
  }
  if (notOpen.length) {
    console.log('В ОЧЕРЕДИ, НО ОТКЛИК НЕЛЬЗЯ ОТПРАВИТЬ: ' + notOpen.length);
    for (const r of notOpen) console.log('  ' + r.id + ' закрыта или снята | ' + r.title.slice(0, 44));
  }
  if (report.alreadyAppliedDetected.length) {
    console.log('hh уже показывает, что отклик отправлен: ' + report.alreadyAppliedDetected.join(', '));
  }
  const labels = rows.filter((r) => r.label).slice(0, 6).map((r) => r.id + ' = «' + r.label + '»');
  if (labels.length) console.log('как выглядит надпись на кнопке: ' + labels.join('; '));
  if (falsePositives.length) {
    // Оговорка про слово «ложные». Здесь попадает не одно и то же:
    //
    //   * вакансия правда требует опыта, а отбор её пропустил — тогда отсев
    //     ВЕРЕН, и «ложное срабатывание» означает пропуск отбора;
    //   * опыт не требуется, а формулировка сработала — тогда ошибка в правиле.
    //
    // Разница видна только по тексту описания, поэтому печатается кусок текста
    // вокруг совпадения, и решение принимается чтением, а не числом.
    console.log('СРАБАТЫВАНИЯ НА ЗАЩИЩЁННЫХ: ' + falsePositives.length + ' (см. текст ниже: отсев верен или это ошибка правила)');
    for (const r of falsePositives) {
      console.log('  ' + r.id + ' | ' + r.rule + ' | ' + r.title.slice(0, 40) + ' | ' + (r.company || '').slice(0, 26));
      console.log('      совпадение: «' + r.matched + '»');
      console.log('      текст: ' + r.context.slice(0, 260));
    }
  }
  if (missedDrops.length) {
    // Это не дефект правила: такие вакансии отклонены по смыслу работы
    // (мобильные приложения, контент, чужая среда), а не по порогу опыта.
    console.log('отклонены по другим причинам, порога опыта в тексте нет: ' + missedDrops.length);
    for (const r of missedDrops) console.log('  ' + r.id + ' ' + r.title.slice(0, 40));
  }
  return bad.length === 0 && falsePositives.length === 0 && errors.length === 0 && notOpen.length === 0;
}

main().then((ok) => process.exit(ok ? 0 : 1)).catch((e) => {
  console.log('аудит упал: ' + (e && e.stack));
  process.exit(1);
});