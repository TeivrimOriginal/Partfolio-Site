// Диагностика разбора: показывает, что реально лежит в desc и почему
// не сработали правила отсева. Пишет в файл, чтобы читать без кракозябр.
import fs from 'node:fs';
const list = JSON.parse(fs.readFileSync(process.argv[2] || 'zfull-1275.json', 'utf8'));
const out = [];
for (const v of list) {
  out.push(`### ${v.id} | ${v.title} | ${v.employer} | exp=${v.experience} | ${v.experienceText} | ${v.hours} | ${v.schedule} | ${v.employmentType} | descLen=${(v.desc || '').length} | blk=${(v.blocked || []).join(',') || '-'}`);
  out.push('    ' + (v.desc || '').slice(0, 400));
}
fs.writeFileSync(process.argv[3] || 'zdiag.txt', out.join('\n'), 'utf8');
console.log('-> ', process.argv[3] || 'zdiag.txt', list.length);
