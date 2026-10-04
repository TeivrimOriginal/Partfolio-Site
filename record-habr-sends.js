// Журнал отправленных откликов на Хабр Карьеру и список уже откликнутых.
//
// Зачем отдельный журнал, если есть список: список отвечает на вопрос «на что
// уже откликнулся», журнал — «чем именно было отправлено и что подтвердилось».
// Когда письмо приклеивается вторым шагом («Редактировать» → «Сохранить»),
// это легко принять за отправку отклика: отклик создаётся первым нажатием, а
// письмо может не приклеиться вовсе. Именно так выглядели три вакансии до
// проверки: отклик есть, письма нет.
//
// Формат записи одна на строку, как в hh-apply-results.jsonl, чтобы по обоим
// журналам можно было искать одним способом.
//
// Использование: node record-habr-sends.js
const fs = require('fs');
const path = require('path');

const ID_FILE = 'habr-applied-ids.txt';
const LOG_FILE = 'habr-apply-results.jsonl';

// Письмо сверено с сервером после перезагрузки страницы — это отметка verified.
const SENT = [
  {
    id: '1000168633',
    title: 'AQA Тестировщик (Python)',
    company: 'ITK academy',
    stack: 'qa',
    letterLen: 1304,
    when: '2026-10-04T16:46:00',
    note: 'отклик и письмо были до этого цикла, письмо проверено на странице вакансии',
  },
  {
    id: '1000167096',
    title: 'DevOps Engineer (KORM)',
    company: 'Лаборатория Касперского',
    stack: 'devops',
    letterLen: 1300,
    when: new Date().toISOString(),
    note: 'отклик создан ранее, письмо приклеено кнопкой «Редактировать» и подтверждено перезагрузкой',
  },
  {
    id: '1000168634',
    title: 'DevOps / Infrastructure Engineer (Europe/CIS)',
    company: 'Flex Databases',
    stack: 'devops',
    letterLen: 1454,
    when: new Date().toISOString(),
    note: 'отклик создан нажатием, письмо приклеено и подтверждено перезагрузкой',
  },
  {
    id: '1000168753',
    title: 'Инженер DevOps',
    company: 'Intellectual management systems',
    stack: 'devops',
    letterLen: 1386,
    when: new Date().toISOString(),
    note: 'отклик создан нажатием, письмо приклеено и подтверждено перезагрузкой',
  },
];

const logPath = path.join(__dirname, LOG_FILE);
const existing = fs.existsSync(logPath)
  ? fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean)
  : [];
const byId = new Map(existing.map((r) => [String(r.id), r]));

for (const s of SENT) {
  byId.set(s.id, { ...s, result: 'sent', letterAttached: true, verifiedByReload: true });
}

const lines = [...byId.values()].map((r) => JSON.stringify(r));
fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(__dirname, ID_FILE), SENT.map((s) => s.id).join('\n') + '\n', 'utf8');

console.log('в журнале откликов на Хабре: ' + byId.size);
for (const r of [...byId.values()]) {
  console.log('  ' + r.id + ' | ' + r.title + ' | письмо ' + r.letterLen + ' симв. | ' + (r.verifiedByReload ? 'подтверждено' : 'не подтверждено'));
}
console.log('файлы: ' + ID_FILE + ', ' + LOG_FILE);
