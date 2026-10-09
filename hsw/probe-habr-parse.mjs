// Разбор сохранённой страницы Хабра: сколько вакансий, какие ссылки, есть ли
// разметка с зарплатой и форматом работы. Отдельный файл — PowerShell ломает
// регулярки в `node -e` (гребля, повторяется каждый раз).
import { readFileSync } from 'node:fs';

const t = readFileSync('hsw/probe-habr.html', 'utf8');

const links = [...new Set([...t.matchAll(/href="([^"]*\/vacancies\/[a-z0-9_]+)"/g)].map((m) => m[1]))];
console.log('уникальных ссылок на вакансии:', links.length);
console.log(links.slice(0, 14).join('\n'));

const ids = [...new Set([...t.matchAll(/\/vacancy\/(\d+)/g)].map((m) => m[1]))];
console.log('\nчисловых id:', ids.length, ids.slice(0, 8).join(', '));

// Что есть в разметке про зарплату и формат — по этим словам решаем,
// годится ли площадка вообще под фильтр «удалённо + без опыта».
const probes = {
  'зарплата вилка': /от [\d\s]+ до [\d\s]+/i,
  'руб/мес': /₽|руб/i,
  'удалённая': /удалённ|удаленн/i,
  'remote в json': /"remote"\s*:\s*(true|false)/i,
  'опыт字段': /"experience_level"|"experienceLevel"/i,
  'формат json': /"work_format"|"schedule"|"employment"/i,
  'компания': /"employer"|"company_name"|"brand"/i,
};
for (const [k, re] of Object.entries(probes)) console.log(`${re.test(t) ? '+' : '-'} ${k}`);

// JSON, вшитый в страницу, — самый надёжный источник на SPA.
const jsonBlocks = [...t.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];
console.log('\nблоков application/json:', jsonBlocks.length);
for (const b of jsonBlocks.slice(0, 4)) {
  try {
    const j = JSON.parse(b[1]);
    console.log('  ключи:', Object.keys(j).join(', ').slice(0, 160));
  } catch (e) {
    console.log('  не разобрался:', e.message.slice(0, 60));
  }
}