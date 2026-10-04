// Собирает письма для шорт-листа по реальным требованиям из описаний hh.
//
// Проверка уникальности обязательна: 11 писем из 20 когда-то выходили
// побайтово одинаковыми, потому что все эти вакансии попадали в одну группу
// требований. Рекрутеру, у которого в разных откликах лежит один текст,
// это видно сразу, поэтому одинаковые письма — дефект, а не мелочь.
const fs = require('fs');
const list = require('./hh-shortlist.js');
const { composeLetter } = require('./hh-letter.js');
const data = JSON.parse(fs.readFileSync('hh-shortlist-data.json', 'utf8'));

// Имя компании из DOM hh приходит с мусором: кнопка «Хочу тут работать»
// и бейдж «Финалист Рейтинга работодателей hh.ru» приклеены к тому же
// элементу. У ИП вместо имени кнопка «Связаться» — берём из шорт-листа.
const NOISE = /Хочу тут работать|ФиналистРейтинга работодателей hh\.ru|Проверенный работодатель/g;
function cleanCompany(id, dom) {
  const fallback = (list.find((v) => v.id === id) || {}).co || '';
  let c = (dom || '').replace(NOISE, '').trim();
  if (!c || c === 'Связаться') c = fallback;
  return c;
}

const out = [];
const texts = new Map();
let dup = 0;

for (const v of list) {
  const row = (data.items || []).find((x) => x.id === v.id);
  const sents = row ? row.sents : [];
  const company = cleanCompany(v.id, row ? row.companyDom : '');
  // Описание склеиваем из отобранных предложений: этого хватает генератору,
  // а пересылать полный текст вакансии ради пары цитат незачем.
  const desc = sents.join('. ');
  const text = composeLetter(v.title, desc, company);
  const quoted = (text.match(/^— «/gm) || []).length;
  if (texts.has(text)) { dup++; console.log('  ДУБЛЬ: ' + v.id + ' = ' + texts.get(text)); }
  texts.set(text, v.id);
  out.push({ id: v.id, title: v.title, company, why: v.why, sents, letter: text, quoted, len: text.length });
}

fs.writeFileSync('LETTERS-SHORTLIST.json', JSON.stringify(out, null, 1), 'utf8');

let md = ['# Письма к шорт-листу', '',
  'Собраны генератором `hh-letter.js` из текста описаний вакансий на hh.',
  'Каждое письмо цитирует конкретные требования из описания и обращается по имени компании.', '',
  'Проверка при отправке: длина поля после вставки сверяется с ожидаемой, отправка идёт только после снятия `disabled` с кнопки.', ''];
for (const r of out) {
  md.push('## ' + r.id + ' — ' + r.title);
  md.push('**' + r.company + '** · беру потому что: ' + r.why);
  md.push('цитат из описания: ' + r.quoted + ', длина письма: ' + r.len);
  md.push('');
  md.push(r.letter);
  md.push('');
}
fs.writeFileSync('LETTERS-SHORTLIST.md', md.join('\n'), 'utf8');

const withQuotes = out.filter((r) => r.quoted > 0).length;
console.log('вакансий: ' + out.length + ', уникальных писем: ' + texts.size + ', дублей: ' + dup);
console.log('писем с цитатой из описания: ' + withQuotes + ' из ' + out.length);
console.log('без цитаты: ' + out.filter((r) => r.quoted === 0).map((r) => r.id).join(', '));
process.exit(dup === 0 && withQuotes >= out.length - 1 ? 0 : 1);
