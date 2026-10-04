// Что изменит новое правило «опыт заявлен без числа».
//
// Зачем мерить, а не сразу применять. Правило ловит «ожидаем опыт работы с
// Ansible» и «требуется опыт в Linux». Числового порога в таких текстах нет, но
// требование настоящее, и отклик туда уходит без нужного опыта. Риск обратный:
// фраза может быть пожеланием («будет плюсом опыт»), и тогда правило отсечёт
// вакансию, на которую стоит ответить.
//
// Поэтому прогоняем новое правило по всему, что уже одобрено: письмам hh, Хабру
// и remote-job. Каждое срабатывание печатается с куском текста, чтобы решить
// глазами, а не по статистике.
//
// Использование: node audit-experience-stated.js
const fs = require('fs');
const { reasonIn } = require('./hh-experience.js');

// Тексты берём из отчётов сборщиков: там лежат описания, по которым вакансии уже
// прошли отбор.
const SOURCES = [
  { file: 'remote-job-vacancies.json', label: 'remote-job', desc: 'desc' },
  { file: 'habr-vacancies.json', label: 'хабр', desc: 'desc' },
];

function rowsOf(file) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(data.vacancies) ? data.vacancies : [];
}

// Письма hh: описания лежат в отчётах сборщика hh, а сами письма — в
// LETTERS-SHORTLIST.json. Сверяем по id.
const shortlist = fs.existsSync('LETTERS-SHORTLIST.json') ? JSON.parse(fs.readFileSync('LETTERS-SHORTLIST.json', 'utf8')) : [];
const hhDescriptions = new Map();
for (const f of fs.readdirSync(__dirname)) {
  if (!/^hh-shortlist-data.*\.json$/.test(f)) continue;
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const list = Array.isArray(data) ? data : (data.vacancies || data.rows || []);
    for (const v of list) {
      if (v && v.id) hhDescriptions.set(String(v.id), v.desc || v.description || '');
    }
  } catch (e) { /* файл не в том формате — пропускаем */ }
}

const hits = [];
let checked = 0;

// 1) Вакансии, которые уже отобраны и ждут отправки на hh.
for (const r of shortlist) {
  const desc = hhDescriptions.get(String(r.id));
  if (!desc) continue;
  checked++;
  const why = reasonIn(desc);
  if (why && why.rule === 'experience-stated') {
    hits.push({ source: 'hh очередь', id: r.id, title: r.title, matched: why.matched, context: why.context });
  }
}

// 2) Отобранные вакансии других досок.
for (const s of SOURCES) {
  for (const v of rowsOf(s.file)) {
    const desc = v[s.desc] || '';
    if (!desc) continue;
    checked++;
    const why = reasonIn(desc + ' ' + v.title);
    if (why && why.rule === 'experience-stated') {
      hits.push({ source: s.label, id: v.id, title: v.title, matched: why.matched, context: why.context });
    }
  }
}

console.log('проверено вакансий: ' + checked);
console.log('новое правило сработало: ' + hits.length);
console.log('');
for (const h of hits) {
  console.log('--- ' + h.source + ' | ' + h.id + ' | ' + String(h.title).slice(0, 60));
  console.log('    совпадение: ' + h.matched);
  console.log('    контекст: ' + String(h.context).replace(/\s+/g, ' ').slice(0, 240));
}
