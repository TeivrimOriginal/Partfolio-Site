// Какие вакансии отбора hh отсеивает новое правило «пункт начинается со слова
// «Опыт»», и какие из них уже помечены в отсеве.
//
// Зачем. Сборщик печатает «отсеяно по описанию: 40», из них 7 по новому
// правилу, но не показывает, что это за вакансии. Проверять их надо по тексту:
// часть из них уже лежит в hh-shortlist-drop.js, и тогда новое правило просто
// подтверждает ранее сделанное решение, а не меняет очередь.
//
// Описание берётся со страницы вакансии, потому что в hh-shortlist.js лежат
// только id, заголовок и компания. Хосты чередуются: hh троттлит гостя примерно
// через десяток запросов подряд и начинает отдавать 403 с карточкой входа.
//
// Использование: node audit-bullet-on-shortlist.js
const https = require('https');
const fs = require('fs');
const { reasonIn } = require('./hh-experience.js');

const shortlist = require('./hh-shortlist.js');
const dropModule = require('./hh-shortlist-drop.js');

// hh-shortlist-drop.js экспортирует массив отсева напрямую, а не объектом с
// полем DROPPED. Отсюда нужен отдельный разбор: если экспорт станет объектом,
// скрипт обязан это заметить, а не молча считать отсев пустым.
const dropped = Array.isArray(dropModule)
  ? dropModule
  : (dropModule.DROPPED || dropModule.ROWS || dropModule.DROPPED_ROWS || null);
if (!dropped) {
  console.log('НЕ РАСПОЗНАН формат экспорта hh-shortlist-drop.js: ' + Object.keys(dropModule).join(', ').slice(0, 120));
  process.exit(1);
}

const rows = Array.isArray(shortlist) ? shortlist : (shortlist.vacancies || []);
const droppedIds = new Set(dropped.map((r) => String(r.id)));
const keepIds = new Set((dropModule.KEEP_NOT_DROPPED || []).map((r) => String(r.id)));

const HOSTS = ['https://hh.ru', 'https://zarechny.hh.ru'];
const PAUSE_MS = 900;
const CONCURRENCY = 2;
let turn = 0;

function get(url, depth) {
  depth = depth || 0;
  return new Promise((resolve) => {
    const q = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 5) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).href, depth + 1));
        return;
      }
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    q.setTimeout(25000, () => { q.destroy(); resolve({ code: 0, body: '' }); });
    q.on('error', () => resolve({ code: 0, body: '' }));
  });
}

const ENT = [[/&quot;/g, '"'], [/&#39;/g, "'"], [/&laquo;/g, '«'], [/&raquo;/g, '»'], [/&mdash;/g, '—'], [/&middot;/g, '·'], [/&nbsp;/g, ' '], [/&amp;/g, '&']];

function txt(h) {
  let t = String(h || '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  for (const [re, to] of ENT) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function descriptionOf(html) {
  const open = html.indexOf('data-qa="vacancy-description"');
  if (open < 0) return '';
  const start = html.indexOf('>', open);
  if (start < 0) return '';
  const close = html.indexOf('data-qa="vacancy-description-next"', start);
  return txt(html.slice(start, close > 0 ? close : Math.min(html.length, start + 80000)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('в отборе hh: ' + rows.length + ' вакансий');
  console.log('уже в отсеве: ' + droppedIds.size + ', защищено от отсева: ' + keepIds.size);
  console.log('');

  const found = [];
  let cursor = 0;
  let unreadable = 0;

  async function worker() {
    while (cursor < rows.length) {
      const v = rows[cursor++];
      let desc = '';
      for (let i = 0; i < HOSTS.length * 2; i++) {
        const r = await get(HOSTS[turn++ % HOSTS.length] + '/vacancy/' + v.id);
        if (r.code === 200 && r.body.length > 20000 && !/Войти или зарегистрируйтесь/.test(r.body.slice(0, 3000))) {
          desc = descriptionOf(r.body);
          if (desc) break;
        }
        await sleep(900);
      }
      if (!desc) { unreadable++; await sleep(PAUSE_MS); continue; }
      const w = reasonIn(desc);
      if (w) {
        found.push({
          id: String(v.id), title: v.title, company: v.co || v.company || '',
          rule: w.rule, matched: String(w.matched), context: w.context || '',
          // lacks — названные технологии, которых у него нет. Без этого поля
          // причина отказа в отчёте выглядит как «что-то с опытом», и в
          // hh-shortlist-drop.js попадали бы записи без объяснения.
          lacks: w.lacks || [],
          alreadyDropped: droppedIds.has(String(v.id)), protected: keepIds.has(String(v.id)),
        });
      }
      await sleep(PAUSE_MS);
    }
  }

  const ws = [];
  for (let i = 0; i < CONCURRENCY; i++) ws.push(worker());
  await Promise.all(ws);

  const byRule = {};
  for (const f of found) byRule[f.rule] = (byRule[f.rule] || 0) + 1;

  console.log('отсеяно по правилам: ' + JSON.stringify(byRule));
  console.log('не прочитано: ' + unreadable);
  console.log('');

  for (const f of found) {
    const where = f.alreadyDropped ? 'уже в отсеве' : (f.protected ? 'ЗАЩИЩЕНА — спорная' : 'НОВОЕ, меняет очередь');
    console.log('  ' + f.id + ' | ' + f.rule + ' | ' + String(f.title).slice(0, 44) + ' | ' + String(f.company).slice(0, 24));
    console.log('      ' + where + '  «' + f.matched + '»');
    console.log('      ' + f.context.slice(0, 180));
  }

  const fresh = found.filter((f) => !f.alreadyDropped && !f.protected);
  console.log('');
  console.log('новых отсевов, меняющих очередь: ' + fresh.length);
  if (fresh.length) {
    console.log('эти вакансии стоит добавить в hh-shortlist-drop.js:');
    for (const f of fresh) console.log('  ' + f.id + ' — ' + f.title + ' (' + f.company + '): ' + f.rule);
  }

  fs.writeFileSync('hh-bullet-audit.json', JSON.stringify({ found: found, unreadable: unreadable }, null, 1) + '\n', 'utf8');
  console.log('отчёт: hh-bullet-audit.json');
})();