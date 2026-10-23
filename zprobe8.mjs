// Точечная проверка двух непроходящих случаев: видно, что именно ловит
// регулярка и что остаётся в предложении.
import { expCheck } from './zexp-rule.mjs';

const PHRASES = [
  'Тpебовaния: oпыт paбoты в электpoмонтаже oт 2x лeт',
  'Желателен опыт работы в 1С, но не обязателен',
];

// Тот же список омоглифов, что в правиле
const HOM = { 'е': 'e', 'о': 'o', 'а': 'a', 'с': 'c', 'х': 'x', 'р': 'p', 'у': 'y', 'к': 'k', 'м': 'm', 'т': 't', 'в': 'b', 'н': 'h' };
function hom(word) { return [...word].map(ch => (HOM[ch] ? `[${ch}${HOM[ch]}]` : ch)).join(''); }
const UNIT_YEAR = `${hom('лет')}|${hom('года')}|${hom('год')}`;

for (const p of PHRASES) {
  console.log('ФРАЗА:', p);
  const sents = p.split(/(?<=[.!?;])\s+|\n+|•/i).map(s => s.trim()).filter(Boolean);
  for (const s of sents) console.log('  предложение:', JSON.stringify(s));
  const re = new RegExp(`(\\d{1,2})\\s*(?:\\+\\s*)?(?:[xхX]|-\\s*[xхX])?\\s*(?:${UNIT_YEAR})`, 'gi');
  console.log('  периоды:', JSON.stringify([...p.matchAll(re)].map(m => m[0])));
  console.log('  результат:', JSON.stringify(expCheck(p)));
}
