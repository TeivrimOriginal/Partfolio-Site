ДОКАЗАТЕЛЬСТВО. Не выдумывать содержимое этого файла.
Источник: https://github.com/TeivrimOriginal/practice-automation-tests/blob/main/README.md
Что сверялось: 47 UI-автотестов: 28 позитивных, 13 негативных, 6 на форму
Снято: 2026-10-05
Символов: 8819
# UI-автотесты practice-automation.com

Автотесты на Selenium + Pytest + Allure для трёх страниц с упражнениями
<https://practice-automation.com/>:

| Страница | Адрес |
|---|---|
| Calendars | <https://practice-automation.com/calendars/> |
| Modals | <https://practice-automation.com/modals/> |
| Ads | <https://practice-automation.com/ads/> |
| Contact form (главная + модалка с формой) | <https://practice-automation.com/> |

Всего 47 тестов: на трёх основных страницах 28 позитивных и 13 негативных, плюс 6 тестов
формы обратной связи (включая обязательный пункт задания — заполнение поля `Message`
списком из раздела Automation Tools через запятую).

---

## 1. Что нужно

* Python 3.12+
* Chrome или Firefox (актуальные версии)
* Selenium Manager сам скачивает драйвер, отдельно ставить chromedriver не надо
* Allure Commandline — только чтобы посмотреть HTML-отчёт (нужна Java)

## 2. Установка

```bash
cd practice-automation-tests
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

## 3. Запуск

```bash
run.bat                       # все тесты, headless Chrome
run.bat --headful             # с видимым окном браузера
run.bat --br firefox          # Firefox
run.bat tests/test_modals.py  # один файл
run.bat -k negative           # только негативные
run.bat --base http://127.0.0.1:8000   # прогон против локальной копии сайта
```

Ключи pytest: `--br chrome|firefox|edge`, `--headful`, `--base URL`, `--w 15` (таймаут ожидания, сек).

## 4. Отчёт Allure

```bash
report.bat                           # прогон + allure generate + allure open
allure serve allure-results          # нужен allure CLI (Java)
npx allure serve allure-results      # альтернатива через node
allure generate allure-results -o allure-report --clean
```

В отчёте у каждого теста видно feature/story, шаги `allure.step` с осмысленными названиями,
текущий URL, а при падении — **скриншот** и исходник страницы. Скриншоты дополнительно
складываются в `shots/`.

## 5. Структура

```
conftest.py            фикстуры: браузер, скриншоты, аттачи Allure, опции запуска
pages/base.py          базовый Page Object: поиск по цепочке локаторов, ожидания, ввод, клики
pages/calendars.py     календари
pages/modals.py        модальные окна
pages/ads.py           реклама
pages/contact.py       форма обратной связи
pages/home.py          раздел Automation Tools на главной
tests/                 тесты
```

Каждый Page Object прячет цепочку локаторов (`Base.find` берёт первый, который реально есть
на странице) и жёсткие ожидания `WebDriverWait`- класса. Паттерн Page Object Model.

---

# 6. Тестовые сценарии

## 6.1 Calendars — `/calendars/`

### Позитивные (10)

| # | Тест | Что проверяет |
|---|---|---|
| 1 | `test_page_opens_and_shows_three_date_inputs` | заголовок страницы и наличие трёх полей даты `#datepicker1/2/3` |
| 2 | `test_top_form_date_field_is_empty` | поле «Select or enter a date» пустое при загрузке |
| 3 | `test_datepicker1_opens_after_click` | клик по первому полю открывает пикер `#ui-datepicker-div` |
| 4 | `test_datepicker1_day_click_fills_the_input` | выбор дня 15 записывает дату в поле |
| 5 | `test_datepicker1_value_contains_selected_day` | в поле стоит дата в формате `дд.мм.гггг` и содержит выбранный день |
| 6 | `test_datepicker1_next_arrow_switches_month` | стрелка «вперёд» меняет месяц в заголовке пикера |
| 7 | `test_datepicker1_prev_arrow_returns_to_start_month` | стрелка «назад» возвращает исходный месяц |
| 8 | `test_datepicker2_opens_after_click` | второй календарь открывается по клику |
| 9 | `test_datepicker2_close_button_hides_picker` | кнопка «Close» прячет пикер |
| 10 | `test_datepicker3_day_click_fills_the_input` | выбор дня 20 в третьем календаре пишет дату в поле |

### Негативные (5)

| # | Тест | Что проверяет |
|---|---|---|
| 1 | `test_no_picker_is_visible_before_click` | до клика пикер не показан |
| 2 | `test_empty_form_cannot_be_submitted` | пустая форма не отправляется: браузер показывает «Please fill out this field», URL не меняется |
| 3 | `test_month_navigation_without_pick_keeps_field_empty` | листание месяцев без выбора дня не меняет поле |
| 4 | `test_unselectable_day_does_not_fill_the_input` | клик по заблокированному (`ui-datepicker-unselectable`) дню не пишет дату |
| 5 | `test_garbage_text_is_not_turned_into_a_date` | произвольный текст в поле даты не превращается в дату |

## 6.2 Modals — `/modals/`

### Позитивные (9)

| # | Тест | Что проверяет |
|---|---|---|
| 1 | `test_modals_page_opens` | заголовок страницы |
| 2 | `test_all_trigger_buttons_are_visible` | видны все кнопки-триггеры (Simple / Confirm / Image) |
| 3 | `test_simple_modal_opens_with_title` | Simple Modal открывается, заголовок «Simple Modal» |
| 4 | `test_simple_modal_shows_its_text` | в окне текст «Hi, I’m a simple modal.» |
| 5 | `test_simple_modal_closes_by_cross` | крестик закрывает окно |
| 6 | `test_confirm_modal_opens` | Confirm Modal открывается, заголовок «Confirm Modal» |
| 7 | `test_confirm_modal_closes_by_ok` | кнопка OK закрывает окно |
| 8 | `test_confirm_modal_closes_by_cancel` | кнопка Cancel закрывает окно |
| 9 | `test_image_modal_contains_picture` | Image Modal открывается и содержит картинку |

### Негативные (4)

| # | Тест | Что проверяет |
|---|---|---|
| 1 | `test_no_modal_is_visible_on_page_load` | до клика ни одного модального окна нет |
| 2 | `test_closed_modal_stays_hidden` | после закрытия окно не появляется снова через 2 секунды |
| 3 | `test_click_inside_modal_does_not_close_it` | клик по содержимому окна не закрывает его |
| 4 | `test_repeated_clicks_open_single_popup` | три клика по триггеру не дают нескольких окон сразу |

## 6.3 Ads — `/ads/`

### Позитивные (9)

| # | Тест | Что проверяет |
|---|---|---|
| 1 | `test_ads_page_opens` | заголовок страницы |
| 2 | `test_countdown_message_is_shown` | на странице есть текст отсчёта «An ad will appear in 5…4…3…2…1» |
| 3 | `test_countdown_shows_whole_sequence` | отсчёт показывает всю последовательность 5-4-3-2-1 |
| 4 | `test_ad_appears_after_countdown` | после отсчёта появляется рекламный блок |
| 5 | `test_ad_has_visible_content` | рекламный блок не пустой, есть текст/картинка |
| 6 | `test_ad_close_button_is_inside_ad_block` | крестик закрытия находится внутри рекламного блока |
| 7 | `test_ad_can_be_closed` | реклама закрывается крестиком |
| 8 | `test_page_usable_after_ad_closed` | после закрытия страница снова доступна |
| 9 | `test_ad_appears_again_after_reload` | после перезагрузки реклама показывается заново |

### Негативные (4)

| # | Тест | Что проверяет |
|---|---|---|
| 1 | `test_ad_is_not_visible_right_after_load` | сразу после загрузки рекламы нет |
| 2 | `test_ad_is_not_visible_before_countdown_ends` | через 3 секунды (до конца отсчёта) рекламы ещё нет |
| 3 | `test_ad_does_not_return_after_close` | закрытая реклама не возвращается через 6 секунд |
| 4 | `test_only_one_ad_block_visible` | одновременно виден ровно один рекламный блок |

## 6.4 Contact form — форма в модальном окне

| # | Тест | Что проверяет |
|---|---|---|
| 1 | `test_message_field_gets_automation_tools_list` | **пункт задания №5**: Selenium собирает список элементов раздела Automation Tools, склеивает через запятую и вписывает в `Message`; поле содержит ровно этот список |
| 2 | `test_form_is_reachable_from_modals_page` | форма доступна на странице модалок |
| 3 | `test_form_sends_and_shows_confirmation` | заполненная форма отправляется, появляется «Your message has been sent» |
| 4 | `test_long_message_is_accepted` | в `Message` влезает длинный текст (900 символов) |
| 5 | `test_empty_required_name_blocks_submission` | без обязательного Name успеха нет — тест негативный |
| 6 | `test_empty_form_does_not_send_anything` | полностью пустая форма не отправляется — тест негативный |

---

## 7. Замечания

* Локаторы описаны цепочками (`#datepicker1` → `input[id*='datepicker1']` и т.д.), поэтому
  тесты не падают из-за переименования классов на стороне сайта.
* Реклама и календари зависят от JS — используются явные ожидания, а не `sleep`.
* Тесты `test_unselectable_day_does_not_fill_the_input` и `test_empty_form_cannot_be_submitted`
  проходят в обоих вариантах сайта: если заблокированных дней или нативной валидации нет,
  проверяется, что поле осталось пустым.
* Перед прогоном отключите блокировщики рекламы (браузер запускается с чистым профилем).
* В `.github/workflows/tests.yml` лежит прогон в GitHub Actions: `python -m pytest`,
  артефакты `allure-results` выгружаются всегда, `shots` — при падении.
  Прогон **не блокирует ветку** (`continue-on-error`): сайт закрыт проверкой браузера,
  и с раннера GitHub на любую страницу приходит заглушка «Checking your browser»,
  поэтому все 40 тестов падают на элементах, которых не было. Локально набор
  проходит, в CI — нет; это ограничение окружения, а не тестов.
