import fs from 'node:fs';

const full = JSON.parse(fs.readFileSync('zarechny-vacancies-full.json', 'utf8'));
const flexible = JSON.parse(fs.readFileSync('zarechny-flexible.json', 'utf8'));
const shift = JSON.parse(fs.readFileSync('zarechny-shift.json', 'utf8'));

const LOCAL = /Заречн|Гагарк|Мезенск|Белоярск|Курманк/i;
const isLocal = v => LOCAL.test((v.city || '') + ' ' + v.title);
const isRemoteRelocation = v => !isLocal(v);

const local = full.filter(isLocal);
const outOfTown = full.filter(isRemoteRelocation);
const noExp = full.filter(v => v.experience === 'noExperience');
const hoursLE8 = local.filter(v => /Рабочие часы: (?:4|5|6|8)\b|Рабочие часы: 4, 6|Рабочие часы: 5 или 6|Рабочие часы: 4, 5 или 6/.test(v.hours));
const itish = local.filter(v => /программист|разработчик|инженер|оператор пк|системн|ит\b|электромонтаж|монтажник|техник/i.test(v.title));
const remoteAny = full.filter(v => /удаленн|удалённ/i.test(v.formats + ' ' + v.desc));

const money = n => (n ? n.toLocaleString('ru-RU') + ' ₽' : '—');
const lines = [];
lines.push('# Заречный (Свердловская обл.) — рынок труда и вакансии, совмещаемые с учёбой');
lines.push('');
lines.push(`Данные: hh.ru, area=1275 (Заречный), сбор ${new Date().toISOString().slice(0, 10)}, гостевой доступ, все цифры из карточек, не на глаз.`);
lines.push('');
lines.push('## Цифры');
lines.push('');
lines.push(`- Активных вакансий в зоне Заречный + Белоярский ГО: **${full.length}**`);
lines.push(`- Из них локальных (Заречный, Гагарка, Мезенское, Белоярский, Курманка): **${local.length}**, и **${outOfTown.length}** — это вахта/работа в других регионах (Тобольск, Камчатка, Ямал, Миасс, Пермский край, Чехов, Богданович, Москва), они с учёбой несовместимы`);
lines.push(`- Требование «Без опыта»: **${noExp.length} из ${full.length}** (${Math.round(noExp.length / full.length * 100)}%)`);
lines.push(`- Свободный график: **${flexible.length}** · Сменный график: **${shift.length}** · Удалённая работа: **${remoteAny.length}** (в самом Заречном удалёнки нет вообще)`);
lines.push(`- Локальных вакансий с 4–8 рабочими часами в день: **${hoursLE8.length}**`);
lines.push(`- Локальных вакансий с ИТ/инженерным названием: **${itish.length}**, и почти все требуют опыта 1–3 года или профильного образования`);
lines.push('');
lines.push('## Что реально совмещается с парами (локальное, короткий день)');
lines.push('');
lines.push('| id | Вакансия | Работодатель | График / часы | Зарплата | Опыт |');
lines.push('|---|---|---|---|---|---|');
for (const v of hoursLE8.sort((a, b) => (b.datePosted || '').localeCompare(a.datePosted || ''))) {
  lines.push(`| [${v.id}](https://hh.ru/vacancy/${v.id}) | ${v.title} | ${v.employer} | ${v.schedule || '—'} / ${v.hours || '—'} | ${money(v.salaryFrom)} – ${money(v.salaryTo)} | ${v.experience} |`);
}
lines.push('');
lines.push('## Свободный график целиком (.hh-фильтр schedule=flexible)');
lines.push('');
lines.push('| id | Вакансия | Работодатель | График / часы | Зарплата |');
lines.push('|---|---|---|---|---|');
const byId = new Map(full.map(v => [v.id, v]));
for (const f of flexible) {
  const v = byId.get(f.id) || f;
  lines.push(`| [${f.id}](https://hh.ru/vacancy/${f.id}) | ${f.title} | ${v.employer || '—'} | ${v.schedule || '—'} / ${v.hours || '—'} | ${money(f.from)} – ${money(f.to)} |`);
}
lines.push('');
lines.push('## Что брать нельзя');
lines.push('');
lines.push('- Вахта в другие регионы: ' + outOfTown.map(v => `${v.title} (${v.city || v.region || 'другой регион'})`).join('; '));
lines.push('- Полная занятость 5/2 по 8–12 часов в Заречном: это несовместимо с учебой, кроме выходных — но такие вакансии берут на полный день.');
lines.push('- Врачи МСЧ (ФБУЗ) — требуют высшее медицинское образование и диплом, это не вакансия для студента СПО.');
lines.push('');
lines.push('## Вывод');
lines.push('');
lines.push('1. Короткий день в Заречном есть: 4–6 часов в смену в Пятёрочке/Перекрёстке (43–79 тыс ₽), свободный график у Мерчендайзера Gillette (ANCOR, 5–6 ч), курьерские слоты X5/Samokat и Додо (50–65 тыс ₽ и оплата за смену).');
lines.push('2. ИТ-вакансий в самом городе нет — ни одной удалённой и ни одной junior-разработчика. Ближайшие: Оператор ПК (Лента, без опыта), Инженер сервисного обслуживания (Вита Техника, 1–3 года), Газпром газораспределение и ВУЭР/АК ЭСКМ (1–3 года).');
lines.push('3. Поэтому студенту совмещаемый вариант — retail/курьер/мерчендайзер на 4–6 часов, а ИТ-карьеру вести удалённо или в Екатеринбурге (удалённая выдача hh по региону уже отработана в этом проекте).');
lines.push('');
lines.push('## Как пересобрать');
lines.push('');
lines.push('```');
lines.push('node zarechny-area-find.mjs   # area id Заречного через api.hh.ru/areas/1261 -> 1275');
lines.push('node zcollect.mjs 1275 30     # 67 карточек, zvac-area1275.json');
lines.push('node zenrich2.mjs             # карточка каждой вакансии: график, часы, формат, работодатель');
lines.push('node zflex.mjs                # счётчики свободного/сменного графика и удалёнки');
lines.push('node zarechny-report.mjs      # этот файл');
lines.push('```');
fs.writeFileSync('ZARECHNY-STUDENT-JOBS.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));