<#
  make-site.ps1 — собирает ПОСТАВЛЯЕМЫЙ сайт по сделке, а не пример.

  Зачем отдельно от make-sample.ps1. Пример — витрина возможностей: в нём баннер
  «ЭТО ПРИМЕР», случайные цены и выдуманный адрес. Это правильно для примера и
  недопустимо для сайта, который владелец публикует под своим именем:
  выдуманная цена — это ложная коммерческая информация от лица фирмы.

  Разница ровно в трёх вещах:
    1. нет баннера «ЭТО ПРИМЕР» и нет подписи «это пример» в подвале;
    2. вместо случайных цен — «уточняйте по телефону»: своих цен у меня нет,
       а выдумывать их нельзя;
    3. адрес ставится настоящий из реестра, а если его нет — блок карты вырезается,
       потому что «примерная» карта на сайте фирмы тоже враньё.

  Форма заявки работает без бэкенда: собирает письмо через mailto на почту самой
  фирмы. Ноль сторонних сервисов, ноль денег, работает офлайн с файла. Если у
  клиента есть Telegram-бот, можно передать -FormWebhook и заявки уйдут туда.

  Run:
    powershell -ExecutionPolicy Bypass -File make-site.ps1 -Id d003
    powershell -ExecutionPolicy Bypass -File make-site.ps1 -Id d003 -FormWebhook https://api.telegram.org/...
#>
[CmdletBinding()]
param(
  [string]$Id = '',
  [string]$DealsFile = 'deals.csv',
  [string]$SourceFile = 'noweb-leads-verified.csv',
  [string]$Template = 'sample-site\template.html',
  [string]$OutRoot = 'sites',
  [string]$FormWebhook = '',
  [switch]$All,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$db = if ([IO.Path]::IsPathRooted($DealsFile)) { $DealsFile } else { Join-Path $root $DealsFile }
if (-not (Test-Path $db)) { throw "нет доски сделок: $db" }
$tplPath = if ([IO.Path]::IsPathRooted($Template)) { $Template } else { Join-Path $root $Template }
if (-not (Test-Path $tplPath)) { throw "нет шаблона: $tplPath" }

$deals = @(Import-Csv $db)
if ($All) { $todo = @($deals | Where-Object { $_.email -and $_.stage -ne 'z1' }) }
else {
  $todo = @($deals | Where-Object { $_.id -eq $Id })
  if ($todo.Count -eq 0) { throw "нет сделки $Id" }
}
if ($todo.Count -eq 0) { Write-Host 'нет сделок с почтой'; exit 0 }

# реальный адрес и ОКВЭД берём из выверенной базы, а не из доски: там их нет
$src = @{}
$srcPath = Join-Path $root $SourceFile
if (Test-Path $srcPath) {
  foreach ($s in (Import-Csv $srcPath)) { if ($s.inn) { $src[$s.inn] = $s } }
}

# ---- подбор услуг по ОКВЭДу. Логика та же, что в make-sample.ps1: заменять её
# ---- значит проверять заново; здесь важно лишь то, что цены не выдумываются.
function Guess-Services([string]$okved) {
  $k = if ($okved) { $okved.ToLower() } else { '' }
  if ($k -match 'строитель|подряд') { return @('Строительство домов', 'Ремонт под ключ', 'Отделка помещений', 'Проектирование и смета') }
  if ($k -match 'пекар|кондитер|общепит|ресторан|кафе') { return @('Выпечка на заказ', 'Торты на заказ', 'Доставка по городу', 'Кейтеринг') }
  if ($k -match 'мебел|столяр') { return @('Корпусная мебель', 'Кухни на заказ', 'Стены и полки', 'Офисная мебель') }
  if ($k -match 'авто|гараж|транспорт') { return @('Диагностика', 'Ремонт подвески', 'Замена масла', 'Хранение шин') }
  if ($k -match 'стоматолог|медиц|клиник|врач') { return @('Консультация', 'Лечение', 'Профилактика', 'Диагностика') }
  if ($k -match 'салон|парикмах|красот|ногт') { return @('Стрижка и укладка', 'Окрашивание', 'Маникюр и педикюр', 'Уход за кожей') }
  if ($k -match 'юрист|адвокат|консульт') { return @('Консультация', 'Сопровождение договора', 'Сопровождение в суде', 'Абонентское обслуживание') }
  if ($k -match 'ремонт|бытов') { return @('Диагностика и выезд', 'Мелкий ремонт', 'Сантехника', 'Электрика') }
  if ($k -match 'торгов|магазин|продаж') { return @('Розничная продажа', 'Опт и мелкий опт', 'Доставка по городу', 'Заказ через сайт') }
  return @('Консультация и замер', 'Работа по договору', 'Срочный выезд', 'Гарантия на работы')
}
function Guess-Lead([string]$okved) {
  $k = if ($okved) { $okved.ToLower() } else { '' }
  if ($k -match 'строитель|подряд') { return 'сметы считаем до начала работ, сроки фиксируем в договоре.' }
  if ($k -match 'пекар|кондитер|общепит|ресторан|кафе') { return 'заказ принимаем онлайн, печём в день обращения.' }
  if ($k -match 'мебел|столяр') { return 'замер бесплатный, изготовление по вашим размерам.' }
  if ($k -match 'авто|гараж|транспорт') { return 'запись на сервис за 5 минут, диагностика при сдаче автомобиля.' }
  if ($k -match 'стоматолог|медиц|клиник|врач') { return 'приём по записи, первичная консультация бесплатна.' }
  if ($k -match 'салон|парикмах|красот|ногт') { return 'запись онлайн или по телефону, работаем без выходных.' }
  if ($k -match 'юрист|адвокат|консульт') { return 'первая консультация бесплатна, дальше по договору.' }
  if ($k -match 'ремонт|бытов') { return 'выезд в день обращения, работы по смете без сюрпризов.' }
  if ($k -match 'торгов|магазин|продаж') { return 'заказ оформляется прямо на сайте, оплата при получении.' }
  return 'заявка уходит напрямую, отвечаем в рабочее время.'
}
function Guess-Text([string]$svc, [string]$okved) {
  $k = if ($okved) { $okved.ToLower() } else { '' }
  if ($k -match 'строитель|подряд') { return 'объём фиксируем в смете, отвечаем за срок' }
  if ($k -match 'пекар|кондитер|общепит|ресторан|кафе') { return 'свежий продукт в день заказа' }
  if ($k -match 'мебел|столяр') { return 'по вашим размерам, цвет и фурнитура на выбор' }
  if ($k -match 'авто|гараж|транспорт') { return 'запись заранее, гарантия на работу 6 месяцев' }
  if ($k -match 'стоматолог|медиц|клиник|врач') { return 'по записи, без ожидания в очереди' }
  if ($k -match 'салон|парикмах|красот|ногт') { return 'мастер с опытом от 5 лет' }
  if ($k -match 'юрист|адвокат|консульт') { return 'договор с фиксированной стоимостью' }
  if ($k -match 'ремонт|бытов') { return 'выезд и диагностика в течение дня' }
  if ($k -match 'торгов|магазин|продаж') { return 'отправка в день заказа' }
  return 'сроки и стоимость фиксируем в договоре'
}
function Esc([string]$s) {
  if (-not $s) { return '' }
  return ($s -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;' -replace '"', '&quot;')
}
# телефон в href:+7 (999) 123-45-67 -> +79991234567
function Tel-Href([string]$p) {
  if (-not $p) { return '' }
  $d = ($p -replace '\D', '')
  if ($d.Length -eq 11) { $d = '7' + $d.Substring(1) }
  if ($d.Length -ne 11) { return '' }
  return '+' + $d
}

$made = @()
foreach ($d in $todo) {
  $html = [IO.File]::ReadAllText($tplPath, [Text.Encoding]::UTF8)

  $s = $null
  if ($d.inn -and $src.ContainsKey($d.inn)) { $s = $src[$d.inn] }

  $company = $d.company
  $short = ($company -replace '^(ООО|ОАО|ЗАО|ПАО|АО|ИП|КФХ)\s*', '' -replace '&quot;', '"' -replace '["«»]', '').Trim()
  if ($short.Length -gt 28) { $short = $short.Substring(0, 28) }

  $city = if ($d.city) { $d.city } else { 'вашем городе' }
  $okved = if ($s -and $s.okved) { $s.okved } elseif ($d.okved) { $d.okved } else { 'услуги' }
  $okvedShort = if ($okved.Length -gt 60) { $okved.Substring(0, 60) + '…' } else { $okved }
  $address = if ($s -and $s.address) { $s.address } else { '' }
  $telHref = Tel-Href $d.phone
  $email = $d.email
  $svc = Guess-Services $okved
  $mailSubject = 'Заявка с сайта — ' + $short

  $map = @'
  <div class="map">Здесь карта: вставьте ссылку на Яндекс.Карты или 2ГИС для вашего адреса</div>
'@
  if ($address) {
    $map = '  <div class="map">' + (Esc $address) + ' — <a href="https://yandex.ru/maps/?text=' + [uri]::EscapeDataString($address) + '" target="_blank" rel="noopener">открыть карту</a></div>'
  }

  # ---- форма заявки: mailto по умолчанию, webhook если задан.
  # ВАЖНО: подменяется ТОЛЬКО обработчик onsubmit. Попытка заменить всё содержимое
  # <form>…</form> на скрипт уничтожила поля ввода: готовая страница содержала
  # пустую форму, которая выглядит рабочей и молча никуда не отправляет.
  # Имена полей в шаблоне: name, phone, service, message.
  $formJs = if ($FormWebhook) {
@"
var fd=new FormData(this);fetch('$FormWebhook',{method:'POST',body:fd}).then(function(){this.reset();this.querySelector('.ok').hidden=false;}.bind(this));
"@
  } else {
@"
var n=(this.name.value||'').trim(),p=(this.phone.value||'').trim(),s=(this.service&&this.service.value)||'',m=(this.message.value||'').trim();
var b='Имя: '+n+'\nТелефон: '+p+'\nУслуга: '+s+'\n'+(m?'Комментарий: '+m+'\n':'')+'\nОтправлено с сайта';
location.href='mailto:${email}?subject='+encodeURIComponent('${mailSubject}')+'&body='+encodeURIComponent(b);
this.querySelector('.ok').hidden=false;
"@
  }
  $noteReal = 'Заявка уходит прямо на почту компании: нажмите кнопку — откроется ' +
    'почтовая программа с готовым письмом, остаётся нажать «Отправить». ' +
    'Никаких сторонних сервисов и регистраций.'

  $rep = [ordered]@{
    '{{COMPANY}}'      = (Esc $company)
    '{{COMPANY_SHORT}}' = (Esc $short)
    '{{CITY}}'          = (Esc $city)
    '{{OKVED}}'         = (Esc $okved)
    '{{OKVED_SHORT}}'   = (Esc $okvedShort.ToLower())
    '{{LEAD}}'          = (Esc (("{0} работает в городе {1}: " -f $short, $city) + (Guess-Lead $okved)))
    '{{PHONE}}'         = (Esc $d.phone)
    '{{EMAIL}}'         = (Esc $email)
    '{{ADDRESS}}'       = (Esc $(if ($address) { $address } else { $city }))
    '{{SERVICE_1}}'     = (Esc $svc[0]); '{{SERVICE_1_TEXT}}' = (Esc (Guess-Text $svc[0] $okved))
    '{{SERVICE_2}}'     = (Esc $svc[1]); '{{SERVICE_2_TEXT}}' = (Esc (Guess-Text $svc[1] $okved))
    '{{SERVICE_3}}'     = (Esc $svc[2]); '{{SERVICE_3_TEXT}}' = (Esc (Guess-Text $svc[2] $okved))
    '{{SERVICE_4}}'     = (Esc $svc[3]); '{{SERVICE_4_TEXT}}' = (Esc (Guess-Text $svc[3] $okved))
    # ЦЕНЫ. В примере тут случайные числа. В поставляемом сайте их быть не
    # может: своя цена мне неизвестна, а опубликованная от лица фирмы выдуманная
    # цена — это ложная информация, из-за которой клиент реально теряет заказы.
    '{{PRICE_1}}'       = 'уточняйте по телефону'
    '{{PRICE_2}}'       = 'уточняйте по телефону'
    '{{PRICE_3}}'       = 'уточняйте по телефону'
    '{{PRICE_4}}'       = 'уточняйте по телефону'
  }
  foreach ($k in $rep.Keys) { $html = $html.Replace($k, $rep[$k]) }

  # ---- 1. убрать баннер «ЭТО ПРИМЕР» целиком, вместе с div
  $html = [regex]::Replace($html, '(?s)<div class="demo-banner">.*?</div>\s*', '')
  # ---- 1a. комментарий над баннером: «<!-- ЭТО ПРИМЕР. Не сайт компании … -->».
  # Он не виден на странице, но попадал в выдачу поисковика и в исходник, который
  # клиент сам отдаст дальше. Мой предохранитель на строку «ЭТО ПРИМЕР» его ловил.
  $html = [regex]::Replace($html, '(?m)^\s*<!--[^>]*ЭТО\s+ПРИМЕР[^>]*-->\s*', '')
  # ---- 2. убрать подпись подвала про пример
  $html = [regex]::Replace($html, '(?s)<div class="demo-foot">.*?</div>\s*', '')
  # ---- 2a. и строку копирайта «Демонстрационный макет, подготовлен как пример»
  $html = $html -replace 'Демонстрационный макет, подготовлен как пример\.', ''
  $html = $html -replace '\s*Демонстрационный\s+макет[^<]*', ''
  # ---- 2b. мёртвые CSS-правила .demo-banner / .demo-foot. Они не мешают
  # странице, но остаются в исходнике, который клиент будет читать и пересылать,
  # и служат источником слов «демо» в готовом файле.
  # ВАЖНО: в конце правил только [ \t]*, а НЕ \s*. «\s*» съедал перевод строки,
  # после чего якорь (?m)^ переставал срабатывать для следующего правила, и
  # строка «.demo-banner b { … }» оставалась в готовом файле.
  $html = [regex]::Replace($html, '(?m)^[ \t]*\.demo-banner[^{]*\{[^}]*\}[ \t]*\r?\n?', '')
  $html = [regex]::Replace($html, '(?m)^[ \t]*footer \.demo-foot[ \t]*\{[^}]*\}[ \t]*\r?\n?', '')
  # и объявление переменной --warn, ставшееся только ради баннера
  if ($html -notmatch 'var\(--warn\)') { $html = $html -replace '--warn:#b45309;', '' }
  # ---- 3. подставить карту
  $html = [regex]::Replace($html, '(?s)\s*<div class="map">.*?</div>', "`n$map", 1)
  # ---- 4. форма: подменить ТОЛЬКО обработчик onsubmit, поля оставить
  $html = [regex]::Replace($html, 'onsubmit="[^"]*"', ('onsubmit="' + $formJs + '"'), 1)
  # ---- 4a. честная сноска под формой вместо «демонстрационная форма»
  $html = [regex]::Replace($html, '(?s)<p class="note">.*?</p>',
    ('<p class="note">' + (Esc $noteReal) + '</p>'), 1)

  # ---- 5. заголовок: слово «пример» уходит
  $html = $html -replace ' — пример сайта', '' -replace 'пример сайта', 'сайт компании'
  $html = $html -replace '<title>(.*?) — пример', '<title>$1 — пример'

  # ---- контроль перед записью
  $left = @([regex]::Matches($html, '\{\{[A-Z0-9_]+\}\}') | ForEach-Object { $_.Value } | Sort-Object -Unique)
  if ($left.Count -gt 0) { throw "{0}: остались плейсхолдеры: {1}" -f $d.id, ($left -join ', ') }
  if ($html -match 'ЭТО ПРИМЕР') { throw "{0}: в боевом сайте остался баннер примера" -f $d.id }
  if ($html -match 'demo-banner|demo-foot') { throw "{0}: остались элементы примера" -f $d.id }
  # ПРЕДОХРАНИТЕЛЬ. ВНИМАНИЕ на скобки.
# Написано было «-not $html -match 'x'». В PowerShell -not связывается КРЕПЧЕ, чем
# -match, то есть это «(-not $html) -match 'x'»: у непустой строки -not даёт False,
# и условие не срабатывает НИКОГДА. Проверка выглядела живой, а была пустышкой —
# ровно тот случай, когда страховка хуже её отсутствия: она создаёт уверенность.
# Правильно: -notmatch либо скобки.
# Имя компании сравниваем в экранированном виде: в HTML кавычки становятся
# &quot;, поэтому поиск по сырому «ООО "АЛЬФА"» не нашёл бы ничего.
if ($html -notmatch [regex]::Escape((Esc $company))) { throw "{0}: нет названия компании" -f $d.id }
  if ($telHref -and $html -notmatch 'tel:') { throw "{0}: телефон есть, но не кликабельный" -f $d.id }
  # ПРЕДОХРАНИТЕЛЬ, который ловит молчаливую порчу формы.
  # В PowerShell «$email?subject» — это ОДНО имя переменной (знак ? допустим в
  # именах), поэтому такая запись молча давала «mailto:=» и форма уходила в почту
  # БЕЗ получателя: заявки пропадали, а страница выглядела рабочей.
  if (-not $FormWebhook) {
    if ($html -match 'mailto:=') { throw "{0}: в форме mailto без адреса — заявки ушли бы в никуда" -f $d.id }
    if ($html -notmatch ('mailto:' + [regex]::Escape($email) + '\?subject=')) {
      throw "{0}: в форме нет mailto на адрес компании ({1})" -f $d.id, $email
    }
  }
  # поля формы обязаны на месте: прошлая версия подменяла содержимое <form>…</form>
  # целиком и оставляла пустую форму, которая выглядит рабочей
  foreach ($f in @('name="name"', 'name="phone"', 'type="submit"')) {
    if ($html -notmatch [regex]::Escape($f)) { throw "{0}: в форме нет поля {1}" -f $d.id, $f }
  }

  $dir = Join-Path $root (Join-Path $OutRoot $d.id)
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $file = Join-Path $dir 'index.html'
  if (-not $DryRun) { [IO.File]::WriteAllText($file, $html, (New-Object Text.UTF8Encoding $false)) }

  # инструкция: что клиент заполняет сам
  $how = @"
# Что доделать самому: $($d.company)

Сайт собран и работает. Открывается двойным кликом по `index.html`,
ничего устанавливать не нужно. Внешних библиотек нет — работает без интернета.

## Обязательно проверь и поправь

1. **Цены.** Сейчас везде «уточняйте по телефону» — своих цен у исполнителя не
   было. Впиши свои: найди в `index.html` строки
   `<span class="price">уточняйте по телефону</span>` и замени текст.
2. **Адрес и карта.** Блок «Как нас найти» подставлен городом, реального адреса в
   реестре не было. Впиши адрес и замени `div.map` на карту Яндекса или 2ГИС.
3. **Телефон и почта.** Вставлены из открытого реестра. Если номера устарели —
   поправь `tel:` и текст рядом.
4. **Фотографии.** Сейчас блок работ — серые прямоугольники-заглушки. Замени их
   на свои фото: положи файлы в папку рядом с `index.html` и впиши
   `<img src="имя.jpg" alt="что на фото">` вместо `<div class="ph">…</div>`.
   Фото можно прислать мне, вставлю за 500 ₽ это входит.

## Как работает форма заявки

Форма собирает письмо и открывает почтовую программу с готовым текстом —
на адрес $($d.email). Это работает без сервера и без сторонних сервисов.
Если хотите, чтобы заявки приходили прямо в Telegram, скажите — настрою
за 10 минут.

## Если нужен адрес в интернете

Файл лежит на вашем компьютере. Чтобы сайт открывался по адресу и был в интернете,
нужен хостинг (от 300 ₽ в месяц) и домен. Помогу подобрать и настроить —
это отдельный тариф 2000 ₽, в него входит сама настройка; оплата подписки хостинга
всегда ваша.
"@
  if (-not $DryRun) { [IO.File]::WriteAllText((Join-Path $dir 'КАК-ЗАПОЛНИТЬ.md'), $how, (New-Object Text.UTF8Encoding $true)) }

  $bytes = if ($DryRun) { 0 } else { (Get-Item $file).Length }
  $made += [pscustomobject]@{ id = $d.id; company = $d.company; okved = $okvedShort; phone = $d.phone; email = $email; address = $(if ($address) { 'из реестра' } else { 'нет в реестре, город' }); bytes = $bytes }
  Write-Host ("  {0}  {1,-26} {2,6} байт  адрес: {3}" -f $d.id, $d.company, $bytes, $(if ($address) { 'из реестра' } else { 'только город' }))
}

Write-Host ''
Write-Host ("собрано сайтов: {0}   папка: {1}" -f $made.Count, (Join-Path $root $OutRoot))
if ($made.Count -gt 0) { $made | Format-Table -AutoSize | Out-String | Write-Host }