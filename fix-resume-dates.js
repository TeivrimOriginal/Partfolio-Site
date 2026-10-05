// Убирает недоказуемый год начала работы из резюме.
//
// Зачем. В письмах «с 2022» уже вычистили как недоказуемое, а в одиннадцати
// опубликованных резюме год остался. Проверено по GitHub API:
//
//   самый ранний публичный репозиторий   2024-10-26  just-MESSENGER-php
//   первый C++                            2024-12-03  Copy-Of-The-Moodle
//   первый Python                         2026-09-29  practice-automation-tests
//   первый Rust                           2026-09-20
//
// Года 2022 нет ни в одном репозитории, Kwork публичную дату не отдаёт
// (probe-kwork-date.js), hh требует месяц и год, а выдумывать месяц нельзя.
// Поэтому год убран, а не заменён на 2024: 2024 — это дата первого
// публичного репозитория, а не начало работы.
//
// Плюс убрано слово «коммерческий» из resume-python.html и
// resume-fastapi.html: в NOTES.md оно уже признано нечестным, потому что блок
// опыта на hh остаётся пустым, и «коммерческая разработка» в резюме
// противоречит тому, что он сам пишет в письмах.
//
// Скрипт идемпотентен: повторный запуск находит ноль строк.
const fs = require('fs');
const path = require('path');

const EDITS = [
  ['resume.html',
    'Python с 2022, C++ и Rust — с 2024. Делаю backend-сервисы, REST API и автоматизацию;',
    'Python, C++ и Rust. Делаю backend-сервисы, REST API и автоматизацию;'],
  ['resume.html',
    '<span class="it-d mono">Python · 2022 — н.в.</span>',
    '<span class="it-d mono">Python · по заказам на Kwork</span>'],
  ['resume-python.html',
    'Python с 2022 и он же — мой рабочий коммерческий язык: заказы на Kwork, где я пишу',
    'Python и он же — мой рабочий язык по заказам: заказы на Kwork, где я пишу'],
  ['resume-python.html',
    '<span class="it-d mono">Python &middot; 2022 — н.в.</span>',
    '<span class="it-d mono">Python &middot; по заказам на Kwork</span>'],
  ['resume-backend.html',
    'Бэкенд с 2022: заказы на Kwork — Telegram-боты, парсеры, REST API и интеграции.',
    'Бэкенд по заказам на Kwork — Telegram-боты, парсеры, REST API и интеграции.'],
  ['resume-backend.html',
    'С 2024 пишу на Rust: переписал каталог',
    'Пишу и на Rust: переписал каталог'],
  ['resume-backend.html',
    '<span class="it-d mono">Python &middot; 2022 — н.в.</span>',
    '<span class="it-d mono">Python &middot; по заказам на Kwork</span>'],
  ['resume-cpp.html',
    'C++ с 2024. Пишу то, что считает и рисует',
    'Пишу то, что считает и рисует'],
  ['resume-cpp.html',
    '<span class="it-d mono">Python &middot; 2022 — н.в.</span>',
    '<span class="it-d mono">Python &middot; по заказам на Kwork</span>'],
  ['resume-qa.html',
    '<span class="it-d mono">Python &middot; 2022 — н.в.</span>',
    '<span class="it-d mono">Python &middot; по заказам на Kwork</span>'],
  ['resume-frontend.html',
    '<span class="it-d mono">Python &middot; 2022 — н.в.</span>',
    '<span class="it-d mono">Python &middot; по заказам на Kwork</span>'],
  ['resume-devops.html',
    '<span class="it-d mono">Python &middot; 2022 &mdash; н.в.</span>',
    '<span class="it-d mono">Python &middot; по заказам на Kwork</span>'],
  ['resume1c.html',
    'Программирую с 2022 (Python), с 2024 — C++ и Rust. Спроектировал конфигурацию 1С под',
    'Пишу на Python, C++ и Rust. Спроектировал конфигурацию 1С под'],
  ['resume1c.html',
    '<span class="it-d mono">Python · 2022 — н.в.</span>',
    '<span class="it-d mono">Python · по заказам на Kwork</span>'],
  ['resume-fastapi.html',
    'Python в коммерческой разработке с 2022 года: заказы на Kwork — Telegram-боты,',
    'Python по заказам на Kwork — Telegram-боты,'],
  ['resume-fastapi.html',
    '<span class="it-d mono">Python · 2022 — н.в.</span>',
    '<span class="it-d mono">Python · по заказам на Kwork</span>'],
  ['resumes.html',
    '<p>Автоматизация, интеграции, тестирование. Python с 2022, коммерческие заказы на Kwork.</p>',
    '<p>Автоматизация, интеграции, тестирование. Заказы на Kwork: боты, парсеры, REST API.</p>'],
  ['resume-en.html',
    'Python since 2022, C++ and Rust since 2024. I build backend services, REST APIs and automation;',
    'Python, C++ and Rust. I build backend services, REST APIs and automation;'],
  ['resume-en.html',
    '<span class="it-d mono">Python · 2022 — Present</span>',
    '<span class="it-d mono">Python · client orders on Kwork</span>'],
];

// Год уходит и из строк проектов: первый публичный репозиторий на Rust —
// 2026-09-20, а не 2024.
const EXTRA = [
  ['resume.html',
    '<span class="it-d mono">Actix-Web · SQLite FTS5 · Docker · 2024 — н.в.</span>',
    '<span class="it-d mono">Actix-Web · SQLite FTS5 · Docker</span>'],
  ['resume-en.html',
    '<span class="it-d mono">Actix-Web · SQLite FTS5 · Docker · 2024 — Present</span>',
    '<span class="it-d mono">Actix-Web · SQLite FTS5 · Docker</span>'],
];

function main() {
  const all = EDITS.concat(EXTRA);
  let applied = 0;
  let missed = 0;
  for (const [file, from, to] of all) {
    const full = path.join(__dirname, file);
    if (!fs.existsSync(full)) {
      console.log('НЕТ ФАЙЛА   ' + file);
      missed++;
      continue;
    }
    const text = fs.readFileSync(full, 'utf8');
    if (text.indexOf(from) < 0) {
      console.log('НЕ НАЙДЕНО  ' + file + '  ← ' + from.slice(0, 54));
      missed++;
      continue;
    }
    const count = text.split(from).length - 1;
    fs.writeFileSync(full, text.split(from).join(to), 'utf8');
    console.log('ок ×' + count + '        ' + file + '  ← ' + from.slice(0, 54));
    applied++;
  }
  console.log('');
  console.log('применено: ' + applied + ', не найдено: ' + missed);
  if (missed > 0) {
    console.log('НЕ НАЙДЕНО бывает в двух случаях: правка уже применена раньше (тогда');
    console.log('скрипт идемпотентен и это нормально) или строка изменилась руками.');
  }
  process.exit(0);
}

main();