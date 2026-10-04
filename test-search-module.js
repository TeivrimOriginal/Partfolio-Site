// Проверяем, что собранный скрипт hh-search.js — это ровно то, что запускается:
// синтаксис, наличие дедупа, отсутствие фильтра опыта в URL и правильный
// селектор работодателя. Раньше модуль разошёлся с тем, что я запускал руками.
const fs = require('fs');
const s = require('./hh-search.js');

const src = s.browserScripts.collect(process.env.DONE.split(','), 3);
new Function('return ' + src);
const checks = [
  ['собирается в функцию', true],
  ['дедуп по компании и заголовку присутствует', /sameTitle/.test(src) && /groups\[key\]/.test(src)],
  ['фильтр опыта снят', !/experience=/.test(s.SEARCH_BASE)],
  ['удалённость оставлена', /work_format=REMOTE/.test(s.SEARCH_BASE)],
  ['селектор работодателя верный', src.includes('vacancy-serp__vacancy-employer')],
  ['старый неверный селектор не используется', !src.includes('vacancy-serp-item-employer')],
  ['фильтр вызывается как judge', /judge\(v\)/.test(src)],
  ['список откликов подставлен', src.includes(process.env.DONE.split(',')[0])],
  ['24 запроса по стеку', s.QUERIES.length >= 20],
];

let bad = 0;
for (const [name, ok] of checks) {
  console.log((ok ? '  ok       ' : '  ПРОВАЛ   ') + name);
  if (!ok) bad++;
}
console.log('проверок: ' + checks.length + ', провалов: ' + bad);
process.exit(bad === 0 ? 0 : 1);
