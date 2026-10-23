# Аудит GitHub: TeivrimOriginal (03.10.2026)

Данные: `gh api /user/repos` (18 публичных, 15 приватных), профиль README, topics, issues, деревья файлов.

## Сводка
Профиль читается как «сильный джу Rust/C++», но под этим видно 4 критических дефекта,
из-за которых рекрутер закрывает вкладку раньше, чем дочитывает Projects.

---

## КРИТИЧНО (ломает доверие или основной тезис)

### 1. Единственное доказательство Python — приватный репозиторий
- `practice-automation-tests` = **private: true**, но на него стоит ссылка в профиль README (строка 32).
  Рекрутер кликает → 404.
- В публичных репозиториях **ноль Python**. Языки профиля: C++, Rust, HTML, CSS, PHP, JavaScript.
- Резюме теперь заявляет «Практика на Python с 2022 года». Публично это не подтверждено ничем.
  Это самый дорогой дефект: он обесценивает главный питч.

### 2. `test-games-coop-site`: description = `????????? ?????? ????? ???? ??????????`
Литеральные знаки вопроса в описании репозитория на профиле. Выглядит как поломка.

### 3. Раздутые репозитории: бинарники в истории
| репо | размер | файлов в HEAD | файлов >5MB в HEAD |
|---|---|---|---|
| TeivrimSite | 284 MB | 115 | 0 |
| Teivrim-Engine | 202 MB | 766 | 0 |

HEAD чистый → вес в истории (удалённые бинарники). Клонирование занимает минуты,
на странице GitHub висит предупреждение о large files. Для рекрутера это «плохой гигиен-контроль».

---

## ЛОЖНОЕ СРАБАТЫВАНИЕ (проверено, дефекта нет)
Первая версия отчёта зафиксировала «битые символы `·` → `�` в шапке профиля».
Это артефакт рендеринга консоли Windows, а не порча файла.
Фактическая проверка: строгий UTF-8 decode — **VALID, 2438 bytes**; не-ASCII коды = 183 (`·`), 8594 (`→`), 8212 (`—`).
Профиль README в порядке, править не нужно.

---

## ВЫСОКИЙ (размывает профиль)

### 5. Пять репозиториев-мусора в публичном списке
| репо | проблема |
|---|---|
| VPN-Teivrim | description `test my own vpn`, 1MB |
| Copy-Of-The-Moodle | 0MB, description пустой |
| TDEvuris | 0MB, description пустой |
| just-MESSENGER-php | PHP, первое лицо, стена текста |
| WindowsModuleSystem | чужой проект, Qt 6.8.1, стена текста |
| Minecraft-Launcher-Teivrim-CPP-QT | 0MB, язык не определён, при этом 1 звезда |

Из 18 публичных репозиториев 6 — шум. Каждый рекрутер тратит на них время.

### 6. Звёзды стоят на чужих/мусорных репозиториях
1 звезда: Copy-Of-The-Moodle, just-MESSENGER-php, WindowsModuleSystem, test-games-coop-site,
TeivrimOriginal (профиль), teivrim-novell-engine, Teivrim-Engine, TeivrimSite.
0 звёзд: **Copy-SAI-Paint-with-Rust (TPaint)** — главный проект резюме.
Со стороны это читается как «звёзды на пустых репо, реальная работа без признания».

### 7. Пустые description у 5 репозиториев
Copy-Of-The-Moodle, TDEvuris, TeivrimOriginal, siteForLehaSTR, TeivrimOriginal.github.io.

### 8. Опечатка в имени репозитория хакатона
`IT-Hack-Project-TEIVRIM-social-messendjer` — `messendjer` вместо `messenger`.
Резюме ссылается на этот хакатон как на достижение. Ссылка с опечаткой = небрежность.

### 9. Открытые issue на «сильных» репозиториях
- Teivrim-Engine #1: `чиназесс`
- IT-Hack #3: `Защита от спама сообщений и файлов`
- siteForLehaSTR: 4 issue (dependabot-шумилка)
Незакрытые issue = «не доделал». На движке, который в резюме стоит вторым проектом, это читается плохо.

---

## СРЕДНИЙ

### 10. Topics есть не везде
Есть: TPaint (gui, image-editor, immediate-mode-ui, opengl, rust), Teivrim-Engine, TeivrimSite, новелл-редактор.
Нет: **Cautious-Enigma** (английский сайт, который есть в резюме).

### 11. Описания от первого лица, размытые
- Cautious-Enigma: «You are looking at a website for learning English; I try to create unique content here…»
- just-MESSENGER-php: «Сайт написан на php…»
- WindowsModuleSystem / Minecraft-Launcher: по 2 предложения кириллицей без сути
Формулировки не описывают, что сделано и какой стек.

---

## Что уже хорошо (не трогать)
- Topics на 4 ключевых репозиториях проставлены корректно.
- `Copy-SAI-Paint-with-Rust` description сильный: «15+ tools, layers with masks, PSD export, 140+ automated tests».
- `TeivrimSite` description сильный и честно описывает rewrite с Node.js.
- Профиль README уже переведён на Python/C++ и содержит стек, ссылки, раздел «Currently looking for».
- Звёзд суммарно 10, 2 подписчика, аккаунт с 2024-06-29 — нормально для джуна.

---

## Порядок починки (по цене/эффекту)
1. Сделать `practice-automation-tests` публичным — 1 клик, возвращает доказательство Python.
2. Описания: `test-games-coop-site` (убрать `????`), Copy-Of-The-Moodle, TDEvuris, siteForLehaSTR — по одной строке.
3. Переименовать `IT-Hack-...-messendjer` → `...-messenger` — 1 минута.
4. Закрыть issue Teivrim-Engine #1 и IT-Hack #3.
5. Перенести бинарники из истории: `git filter-repo` на TeivrimSite и Teivrim-Engine.
6. Архивировать или удалить 6 мусорных репозиториев.
7. Topics для Cautious-Enigma.