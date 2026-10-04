// Выгружает генератор письма для выполнения в странице hh.
// Зачем: правила письма должны жить в одном файле (hh-letter.js). Если описать
// генерацию отдельно в браузерном скрипте, она рано или поздно разойдётся с
// hh-letter.js, и письма снова станут одинаковыми.
const fs = require('fs');
const m = require('./hh-letter.js');

// countHits в модуль не экспортируется, но composeLetter его вызывает —
// поэтому привозим и его, иначе в странице будет ReferenceError.
const COUNT_HITS = [
  'function countHits(re, s) {',
  '  if (!re) return 0;',
  '  const m = s.match(new RegExp(re.source, "gi"));',
  '  return m ? m.length : 0;',
  '}',
].join('\n');

const payload = {
  CONTACTS: m.CONTACTS,
  GROUPS: m.GROUPS,
  countHits: COUNT_HITS,
  composeLetter: m.composeLetter.toString(),
  extractRequirements: m.extractRequirements.toString(),
};

fs.writeFileSync('hh-letter-page.json', JSON.stringify(payload));
console.error('payload байт: ' + fs.statSync('hh-letter-page.json').size);
console.log(fs.readFileSync('hh-letter-page.json', 'utf8'));
