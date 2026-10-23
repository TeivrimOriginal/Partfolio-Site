// План действий при нулевом коммерческом опыте — на данных hh, а не на советах.
//
// Вход: zero-exp-fit.json (пул «Без опыта», прошедший правило опыта hh-experience.js).
// Перед выдачей прогоняется judge из hh-target.js, потому что метка «Без опыта»
// ставится работодателем и врёт: в прогоне были «Руководитель ИТ-инфраструктуры»,
// «AI Engineer (Middle)», «Руководитель направления ML», «Lead Data Scientist» —
// и три вакансии Aston, которые в прошлый раз дали 14 отказов из 15.
//
// Порядок в выдаче — по близости к его позиционированию и по тому, что берут без
// собеседования на Screening: Python/backend/QA/C++/стажёрские вилки.
import fs from 'node:fs';
import { judge } from './hh-target.js';

const fit = JSON.parse(fs.readFileSync('zero-exp-fit.json', 'utf8'));
// Если прогон с добиранием сроков уже состоялся, берём его: в нём зарплата, город
// и validUntil из ld+json карточки, а в zero-exp-fit.json срок пустой.
const finalRows = fs.existsSync('zero-exp-final.json') ? JSON.parse(fs.readFileSync('zero-exp-final.json', 'utf8')) : null;
const rowsById = new Map((finalRows || fit.good).map(v => [v.id, v]));

const blocked = [];
const kept = [];
for (const g of fit.good) {
  const v = rowsById.get(g.id) || g;
  const j = judge({ title: v.title, company: v.employer });
  if (!j.ok) { blocked.push({ id: v.id, title: v.title, employer: v.employer, reason: j.reason }); continue; }
  kept.push(v);
}
console.log('после judge: ' + kept.length + ', заблокировано по заголовку/компании: ' + blocked.length);
const byRule = {};
for (const b of blocked) byRule[b.reason] = (byRule[b.reason] || 0) + 1;
console.log('причины judge: ' + JSON.stringify(byRule));

function score(v) {
  const t = v.title.toLowerCase();
  let s = 0;
  if (/python/.test(t)) s -= 6;
  if (/backend|бэкенд/.test(t)) s -= 4;
  if (/стажер|стажёр|ученик|intern/.test(t)) s -= 3;
  if (/c\+\+/.test(t)) s -= 2;
  if (/тест|qa/.test(t)) s -= 1;
  if (/junior|младш/.test(t)) s -= 1;
  if (/аналитик|анализ данных|data/.test(t)) s += 1;
  if (/devops|sre|системн/.test(t)) s += 1;
  if (/1с/.test(t)) s += 2;
  if (/lead|руководител|middle|senior/.test(t)) s += 5;
  if (v.remote) s -= 1;
  if (v.from) s -= 1;
  return s;
}
kept.sort((a, b) => score(a) - score(b) || (a.valid || '').localeCompare(b.valid || ''));

const money = n => (n ? n.toLocaleString('ru-RU') + ' ₽' : '—');
const L = [];
L.push('# Что делать дальше при нулевом коммерческом опыте');
L.push('');
L.push(`Собрано ${fit.generated}. Все числа — из выдачи hh, правила отбора — те же, что в очереди откликов.`);
L.push('');
L.push('## Главное: опыта ноль не у тебя');
L.push('');
L.push('В резюме уже есть фриланс на Kwork (Python/Rust, 2024 — н.в.), 4 месяца Ozon,');
L.push('4 проекта (TPaint, Teivrim-Engine, Anime DB, редактор новелл), командный проект на Unity,');
L.push('140+ автотестов. Не хватает ровно одного — **коммерческого опыта в команде с опытным**');
L.push('разработчиком. Это и есть то, что режут отказы: в сегодняшнем прогоне правило опыта');
L.push('отсеяло 20 вакансий из «без опыта» именно за «коммерческий опыт» и «от 1 года».');
L.push('');
L.push('## Сколько вакансий с пометкой «Без опыта» на самом деле');
L.push('');
L.push('| зона | карточек | «Без опыта» |');
L.push('|---|---|---|');
const pool = JSON.parse(fs.readFileSync('zero-exp-pool.json', 'utf8'));
for (const [k, z] of Object.entries(pool.zones)) L.push(`| ${k} (${z.area}) | ${z.cards} | ${z.noExperienceCount} |`);
L.push('');
L.push('Прежний вывод в NOTES («в удалённой выдаче опыт не требуется — ноль») неверен: он');
L.push('получился на узком стеке Python. По 15 запросам про стажёров и джунов пул «Без опыта»');
L.push('115 удалённо, 64 в Свердловской области, 147 в Москве.');
L.push('');
L.push(`Пройдено по стеку: ${fit.good.length + fit.dropped.length} → по правилу опыта осталось ${fit.good.length} → после judge по заголовку и компании ${kept.length}.`);
L.push('');
L.push('## Куда откликаться (топ по близости к стеку)');
L.push('');
L.push('| id | Вакансия | Работодатель | Зарплата | Удалённо | Действует до |');
L.push('|---|---|---|---|---|---|');
for (const v of kept.slice(0, 30)) L.push(`| [${v.id}](${v.url}) | ${v.title} | ${v.employer} | ${money(v.from)} – ${money(v.to)} | ${v.remote ? 'да' : 'нет'} | ${v.valid || '—'} |`);
L.push('');
L.push('## Четыре шага, в этом порядке');
L.push('');
L.push('1. **Разобрать очередь на 53 отклика** — письма уже написаны, нужна только сессия hh.');
L.push('   Это самый дешёвый ход: он не требует ничего нового от тебя, кроме входа и капчи.');
L.push('   `node -e "const p=require(\'./hh-queue.js\').pending(); console.log(p.length, p[0].id)"`');
L.push('2. **Откликнуться в пул «Без опыта»/стажировок** из таблицы выше. Сейчас там',`${kept.length} вакансий, которые формально берут без опыта и не просят высшее образование.`);
L.push('   Ограничение известно: у большинства требуют высшее; те, где требуют, уже отсеяны правилом.');
L.push('3. **Держать 9 собеседований живыми.** По своему же логу: 44 отклика → 9 собеседований → 24 в ожидании.');
L.push('   Молчание работодателя — это не отказ, но и не оффер: нужен короткий фоллоу-ап через 3–4 дня.');
L.push('4. **Подработка на 4–6 часов в Заречном** (Пятёрочка/Перекрёсток, 43,9–78,8 тыс ₽, свободный график) —');
L.push('   деньги без конфликта с учёбой и без вреда ИТ-поиску, если брать 2–3 смены в неделю.');
L.push('   Вакансии и id — в ZARECHNY-STUDENT-JOBS.md.');
L.push('');
L.push('## Чего не делать');
L.push('');
L.push('- Не откликаться на «стажировку» Aston: в прошлый раз 14 отказов из 15 были именно оттуда.');
L.push('- Не верить метке «Без опыта» как гарантии: в пуле были «Руководитель ИТ-инфраструктуры»,');
L.push('  «AI Engineer (Middle)» и «Lead Data Scientist» с этой меткой. Заголовок важнее метки.');
L.push('- Не ждать «идеальной» вакансии под Python/FastAPI: в удалёнке на 757 карточек сегодня');
L.push('  годных 4, а вакансий с формальным нулём требований — 115. Расширять надо по стажёрским вилкам.');
L.push('');
L.push('## Как пересобрать');
L.push('');
L.push('```');
L.push('node zero-exp-search.mjs   # сырая выдача по 3 зонам, подсчёт меток опыта');
L.push('node zero-exp-filter.mjs   # фильтр по стеку + правило опыта по описанию');
L.push('node zero-exp-plan.mjs     # этот файл');
L.push('```');
fs.writeFileSync('ZERO-EXPERIENCE-PLAN.md', L.join('\n') + '\n', 'utf8');
console.log('\n' + L.slice(0, 40).join('\n'));
console.log('... файл ZERO-EXPERIENCE-PLAN.md, строк', L.length);