// Проверка правила «нужен опыт» на всей выборке: что именно оно блокирует
// и не блокирует ли лишнего. Печатается в файл, чтобы читать без кракозябр.
import fs from 'node:fs';
import { expCheck } from './zexp-rule.mjs';
import { degreeCheck } from './zdegree-rule.mjs';

const files = process.argv.slice(2);
const seen = new Map();
for (const f of files) for (const v of JSON.parse(fs.readFileSync(f, 'utf8'))) { if (v.state) continue; if (!seen.has(v.id)) seen.set(v.id, v); }
const list = [...seen.values()];

const out = [];
// 1) Вакансии, которые правило заблокировало по опыту
const byExp = list.filter(v => expCheck(v.desc || '').hard.length);
out.push(`=== заблокировано по опыту: ${byExp.length}`);
for (const v of byExp.slice(0, 60)) {
  out.push(`${v.id} | ${v.title} | ${v.employer} | ${expCheck(v.desc).hard.join('; ')}`);
}
// 2) Подозрительные: заблокированы, но hh поставил «Без опыта»
const suspicious = byExp.filter(v => v.experience === 'noExperience');
out.push(`\n=== ЗАБЛОКИРОВАНО, НО hh говорит «Без опыта»: ${suspicious.length}`);
for (const v of suspicious) {
  out.push(`${v.id} | ${v.title} | ${v.employer}`);
  for (const h of expCheck(v.desc).hard) {
    const i = v.desc.indexOf(h.replace(/^нужен опыт: /, '').slice(0, 12));
    out.push('    ' + (i >= 0 ? v.desc.slice(Math.max(0, i - 100), i + 120) : h));
  }
}
// 3) Мягкие метки
const softs = list.filter(v => expCheck(v.desc || '').notes.length || degreeCheck(v.desc || '').soft.length);
out.push(`\n=== мягкие метки (не блокирует): ${softs.length}`);
for (const v of softs.slice(0, 40)) {
  out.push(`${v.id} | ${v.title} | ${[...degreeCheck(v.desc).soft, ...expCheck(v.desc).notes].join('; ')}`);
}
fs.writeFileSync('F:/tmp/opencode/exp-audit.txt', out.join('\n'), 'utf8');
console.log('-> F:/tmp/opencode/exp-audit.txt');
console.log('заблокировано по опыту:', byExp.length, '| из них с меткой «Без опыта» у hh:', suspicious.length);
console.log('мягких меток:', softs.length);
