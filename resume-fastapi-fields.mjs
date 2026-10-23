import fs from 'node:fs';

// Готовое содержимое резюме для hh: значения полей + проверка длины «О себе».
// hh ограничивает «О себе» 1000 символами, поэтому длина считается здесь,
// а не на глаз: обрезанный текст молча ломает позиционирование под FastAPI.

const about = `Основной проект — anime-sync-api: асинхронный REST API на FastAPI с PostgreSQL 16.
Идемпотентная синхронизация с AniList (GraphQL) и Jikan (REST), журнал прогонов в базе,
поиск на tsvector с GIN-индексом, миграции Alembic.
Всё проверяется запуском, а не пересказом: 29 тестов проходят и на PostgreSQL 16, и на SQLite,
GIN-индекс создаётся миграцией. Второй проект — TaskHub API: 268 тестов, покрытие 89,8%,
mypy strict и ruff без ошибок, 43 эндпоинта.
Python с 2022: заказы на Kwork — Telegram-боты, парсеры, REST-интеграции по ТЗ.
СПО, учусь до 2027, готов part-time. Ищу junior Python/FastAPI, готов к тестовому заданию.`;

const experience = [
  {
    title: 'Фриланс, заказы на Kwork',
    period: '2022 — настоящее время',
    text: 'Telegram-боты, парсеры сайтов, REST API, автоматизация по ТЗ заказчиков. ' +
      'Работа с внешними HTTP-интеграциями, JSON, файлами, логированием ошибок. kwork.ru/user/teivrim',
  },
  {
    title: 'Инди-игра на Unity, команда с опытным разработчиком',
    period: '2025 — 2026',
    text: 'Код и геймдизайн вместе с опытным разработчиком, подбор людей в проект. ' +
      'Хакатон HackIT: собрал рабочий прототип за выходные.',
  },
];

const skills = ['Python', 'FastAPI', 'PostgreSQL', 'SQL', 'Docker', 'Git', 'Linux', 'REST',
  'HTTP', 'JSON', 'Celery', 'Redis', 'SQLAlchemy', 'Alembic', 'asyncio', 'Pytest', 'Selenium', 'Rust', 'C++'];

const L = [];
L.push('# Резюме для hh: Python-разработчик (FastAPI) — готовые значения полей');
L.push('');
L.push('Файл создан, потому что на hh я **не вошёл**: сессии в браузере нет,');
L.push('а логин и капчу вводит человек. Как только вход выполнен, заполнение — механическая работа по этому файлу.');
L.push('');
L.push('## Состояние входа (проверено пробой в браузере, не на глаз)');
L.push('');
L.push('```');
L.push('URL: https://zarechny.hh.ru/account/login  — заголовок «Вход в личный кабинет»');
L.push('cookies: hhuid, _xsrf, crypted_hhuid ... куки hhid/sid НЕТ');
L.push('на главной: «Войти / Создать резюме» есть, профиля нет');
L.push('проба: /applicant/negotiation_list → 404, /applicant/settings → 403');
L.push('captcha на странице входа: не обнаружена');
L.push('```');
L.push('');
L.push('Вкладка с формой входа уже открыта. Нужно одно действие: ввести телефон и пароль.');
L.push('');
L.push('## Поля резюме');
L.push('');
L.push('| Поле | Значение | Почему именно так |');
L.push('|---|---|---|');
L.push('| Название | `Python разработчик (FastAPI)` | hh ищет по названию; «junior» в названии режет выдачу |');
L.push('| Формат работы | `Удалённая работа` | hh откатывал выбор в прошлый раз — кликнуть руками |');
L.push('| Занятость | `Частичная занятость` | он студент до 2027; полная занятость отсекает часть джуновских вакансий |');
L.push('| График | `Гибкий график` | совмещение с парами |');
L.push('| Опыт работы | `1–3 года` | фриланс с 2022, честно; «Нет опыта» выглядит как пустое резюме |');
L.push('| Зарплата | не указывать | это его цифра, в NOTES так и записано |');
L.push('| Образование | УрТК НИЯУ МИФИ, среднее специальное, 2027 | уже есть в резюме, копируется |');
L.push('| Файл | `resume-fastapi.pdf` (124 474 байт, 1 страница) | проверено: `/Count 1` в байтах PDF |');
L.push('');
L.push('## Навыки — галочки из справочника hh');
L.push('');
L.push(skills.join(' · '));
L.push('');
L.push('## О себе (текст целиком, ' + about.length + ' символов, лимит hh 1000)');
L.push('');
L.push('```');
L.push(about);
L.push('```');
L.push('');
L.push('## Опыт работы — два блока');
L.push('');
for (const e of experience) {
  L.push('**' + e.title + '** — ' + e.period);
  L.push('');
  L.push(e.text);
  L.push('');
}
L.push('## Проекты в резюме — цифры измерены, а не взяты из README');
L.push('');
L.push('**anime-sync-api** (ведущий проект, FastAPI · PostgreSQL 16):');
L.push('');
L.push('```');
L.push('проверено на живой PostgreSQL 16 и на SQLite: 29 тестов проходят в обоих режимах');
L.push('миграция Alembic создаёт ix_anime_title_fts — GIN-индекс полнотекстового поиска');
L.push('таблицы: anime, anime_links, sync_runs');
L.push('tsvector: 12 вхождений, to_tsvector: 2, GIN: 48 — поиск настоящий');
L.push('CI (.github/workflows/test.yml): PostgreSQL 16-сервис, затем тот же набор на SQLite, затем ruff');
L.push('```');
L.push('');
L.push('Скрипт проверки: `verify-anime-pg.py` — поднимает временную базу, гонит миграцию,');
L.push('проверяет индекс, гоняет тесты и удаляет базу. Прогон: `ВСЁ ПОДТВЕРЖДЕНО`, exit 0.');
L.push('');
L.push('**TaskHub API** (второй проект, FastAPI · PostgreSQL · Redis · Celery):');
L.push('');
L.push('```');
L.push('pytest: 263 passed, 5 skipped из 268 собранных, покрытие 89.81% (гейт 85% пройден)');
L.push('ruff check app tests — All checks passed; ruff format --check — 86 файлов отформатированы');
L.push('mypy app — Success: no issues found in 71 source files');
L.push('alembic: 8 таблиц совпадают с моделями, 21 индекс, citext включён, downgrade чистый');
L.push('роутеров API v1: 8, эндпоинтов: 43, ORM-моделей: 7');
L.push('```');
L.push('');
L.push('Скрипт проверки: `PROJECTFASTAPI/verify_migrations.py`.');
L.push('');
L.push('## Чего писать НЕЛЬЗЯ — осталось одно');
L.push('');
L.push('```');
L.push('docker build / docker compose up — НЕ ПРОВЕРЕНО: на машине нет docker');
L.push('(CommandNotFoundException). Dockerfile и docker-compose.yml написаны, но ни разу не собраны.');
L.push('```');
L.push('');
L.push('Всё остальное, что было в блоке запрета раньше (отсутствие Dockerfile, тестов, CI, pg_trgm),');
L.push('параллельная сессия закрыла: файлы появились, покрытие замерено, миграции проверены.');
L.push('Про «798 автотестов суммарно» — цифру убрал из резюме: сегодня измерить её нечем,');
L.push('вместо неё в тексте стоят проверяемые 29 и 268.');
L.push('');
L.push('## Порядок действий после входа');
L.push('');
L.push('1. `https://hh.ru/applicant/resumes` → «Добавить резюме» → назвать `Python разработчик (FastAPI)`.');
L.push('2. Внести поля из таблицы выше, навыки галочками, «О себе» текстом выше.');
L.push('3. Блоки опыта — два, из раздела «Опыт работы».');
L.push('4. Прикрепить `resume-fastapi.pdf`.');
L.push('5. Видимость включается **не** кликом по карточке: нужен клик на клиентском маршруте');
L.push('   `/visibility`, затем кнопка `[data-qa="resume-partial-edit-save"]` (проверено ранее,');
L.push('   иначе настройка откатывается).');
L.push('6. Маршруты `/resume/<id>/about`, `/summary`, `/personal`, `/additional` отдают 404 —');
L.push('   редактировать только через интерфейс.');
L.push('7. После этого очередь из 53 откликов ждёт отправки: `node -e "const p=require(\'./hh-queue.js\').pending(); console.log(p.length, p[0].id)"`.');
L.push('');
fs.writeFileSync('RESUME-FASTAPI-HH.md', L.join('\n') + '\n', 'utf8');
console.log('about length:', about.length, '(limit 1000)');
console.log('skills:', skills.length);
console.log('written RESUME-FASTAPI-HH.md, chars', L.join('\n').length);