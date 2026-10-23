// Сводка по удалёнке для джуна: что уже отправлено, что в очереди, что нового.
//
// Три источника, и каждый отвечает на свой вопрос:
//   hh-queue.js        — что ждёт отправки прямо сейчас (письма уже написаны);
//   hh-candidates.json — что нового нашлось сегодня в удалённой выдаче;
//   ekb-remote-junior.json — отдельный срез: работодатель в Свердловской области,
//                          вакансия удалённая.
const fs = require('fs');
const path = require('path');
const queue = require('./hh-queue.js');

const read = (f) => (fs.existsSync(path.join(__dirname, f)) ? JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')) : null);

const letters = read(queue.LETTERS_FILE) || [];
const applied = fs.existsSync(queue.APPLIED_IDS_FILE)
  ? fs.readFileSync(path.join(__dirname, queue.APPLIED_IDS_FILE), 'utf8').split(',').map(s => s.trim()).filter(Boolean)
  : [];
const results = queue.resultsSummary();
const cand = read('hh-candidates.json');
const candExtra = read('hh-candidates-enriched.json') || [];
const extraById = new Map(candExtra.map(e => [e.id, e]));
const ekb = read('ekb-remote-junior.json');

const appliedSet = new Set(applied);
const pending = letters.filter(r => !appliedSet.has(r.id));

const money = n => (n ? n.toLocaleString('ru-RU') + ' ₽' : '—');
const L = [];
L.push('# Удалённая работа для джуна: что есть, что отправлено, что ждёт');
L.push('');
L.push(`Собрано ${new Date().toISOString().slice(0, 10)} из данных hh и существующей очереди проекта.`);
L.push('');
L.push('## Коротко');
L.push('');
L.push(`- Отправлено откликов: **${applied.length}**`);
L.push(`- Ждёт отправки (письма написаны): **${pending.length}**`);
L.push(`- Результаты прошлых попыток: ${JSON.stringify(results.byResult)}`);
if (cand) {
  L.push(`- Сегодняшний прогон удалённой выдачи: карточек **${cand.cards}**, прошли все правила **${(cand.survivors || []).length}**, отсеяно по описанию **${(cand.rejectedByDescription || []).length}**`);
}
if (ekb) {
  L.push(`- Срез «работодатель в Свердловской области + удалённо»: карточек **${ekb.cards}**, годных **${(ekb.keep || []).length}**`);
}
L.push('');
L.push('## Очередь на отправку (hh, удалённо, для джуна)');
L.push('');
L.push('| # | id | Вакансия | Компания |');
L.push('|---|---|---|---|');
pending.forEach((r, i) => L.push(`| ${i + 1} | [${r.id}](https://hh.ru/vacancy/${r.id}) | ${r.title} | ${r.company} |`));
L.push('');
if (cand && (cand.survivors || []).length) {
  L.push('## Новое сегодня (ещё не в очереди)');
  L.push('');
  L.push('| id | Вакансия | Компания | Город | Действует до |');
  L.push('|---|---|---|---|---|');
  for (const s of cand.survivors) {
    const e = extraById.get(s.id);
    L.push(`| [${s.id}](https://hh.ru/vacancy/${s.id}) | ${s.title} | ${s.company || (e && e.employer) || '—'} | ${(e && e.city) || '—'} | ${(e && e.valid) || '—'} |`);
  }
  L.push('');
}
if (ekb && (ekb.keep || []).length) {
  L.push('## Работодатели из Свердловской области с удалёнкой');
  L.push('');
  L.push('| id | Вакансия | Работодатель | Город | Зарплата | График / часы |');
  L.push('|---|---|---|---|---|---|');
  for (const k of ekb.keep) L.push(`| [${k.id}](${k.url}) | ${k.title} | ${k.employer} | ${k.city || '—'} | ${money(k.from)} – ${money(k.to)} | ${k.schedule || '—'} / ${k.hours || '—'} |`);
  L.push('');
}
if (cand && cand.byReason && Object.keys(cand.byReason).length) {
  L.push('## Почему остальное отсеяно (удалённая выдача, сегодня)');
  L.push('');
  L.push('| причина | вакансий |');
  L.push('|---|---|');
  for (const [k, v] of Object.entries(cand.byReason).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`);
  L.push('');
}
L.push('## Как отправить очередь');
L.push('');
L.push('```');
L.push('node -e "console.log(require(\'./hh-queue.js\').pending().length)"');
L.push('node -e "const p=require(\'./hh-queue.js\').pending()[0]; console.log(p.id, p.title, p.company)"');
L.push('node audit-shortlist-experience.js');
L.push('```');
L.push('');
L.push('Отправка идёт через вкладку браузера: `urlFor(id)` -> открыть -> `applyScriptFor(id)` -> `record(...)`.');
L.push('При результате CAPTCHA или CAPTCHA_AFTER_SUBMIT отправку останавливаем, иначе hh уводит аккаунт в блок.');
L.push('');
fs.writeFileSync(path.join(__dirname, 'REMOTE-JUNIOR-EKB.md'), L.join('\n') + '\n', 'utf8');
console.log(L.join('\n'));