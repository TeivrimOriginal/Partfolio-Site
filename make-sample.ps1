<#
  make-sample.ps1 — собирает персональный пример сайта для конкретной компании.

  Зачем персональный: письмо со вложением «пример сайта» без единого слова о
  компании читается как массовая рассылка и уходит в спам. Одна строка с
  названием и городом — и это уже не спам.

  Шаблон: sample-site\template.html, плейсхолдеры вида {{NAME}}.
  Баннер «ЭТО ПРИМЕР» встроен в шаблон и не вырезается: без него клиент решит,
  что ему прислали действующий сайт, и предъявит его как «уже сделано».

  Run:
    powershell -ExecutionPolicy Bypass -File make-sample.ps1 -Id d001
    powershell -ExecutionPolicy Bypass -File make-sample.ps1 -All
#>
[CmdletBinding()]
param(
  [string]$Id = '',
  [string]$DealsFile = 'deals.csv',
  [string]$Template = 'sample-site\template.html',
  [string]$AdminTemplate = 'sample-site\admin-template.html',
  [string]$OutDir = 'outbox\sample',
  [switch]$All
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$tplPath = Join-Path $root $Template
if (-not (Test-Path $tplPath)) { throw "нет шаблона: $tplPath" }
$db = if ([IO.Path]::IsPathRooted($DealsFile)) { $DealsFile } else { Join-Path $root $DealsFile }
if (-not (Test-Path $db)) { throw "нет доски сделок: $db" }

$deals = @(Import-Csv $db)
if ($All) { $todo = $deals }
else {
  $todo = @($deals | Where-Object { $_.id -eq $Id })
  if ($todo.Count -eq 0) { throw "нет сделки $Id" }
}

$outDirPath = Join-Path $root $OutDir
if (-not (Test-Path $outDirPath)) { New-Item -ItemType Directory -Path $outDirPath -Force | Out-Null }

# --- эвристика под типовые услуги, чтобы демо выглядело живым, а не пустым ---
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
  # возвращаем только «хвост» описания, без повтора названия услуги: карточка уже
  # содержит <h3> с названием, иначе читается «Строительство — Строительство: ...»
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

function Rand-Num { param([int]$a, [int]$b) Get-Random -Minimum $a -Maximum $b }

$made = @()
foreach ($d in $todo) {
  $html = [IO.File]::ReadAllText($tplPath, [Text.Encoding]::UTF8)

  $name = $d.company
  $short = ($name -replace '^(ООО|ОАО|ЗАО|ПАО|АО|ИП|КФХ)\s*', '' -replace '&quot;', '"' -replace '["«»]', '').Trim()
  if ($short.Length -gt 28) { $short = $short.Substring(0, 28) }
  $okved = if ($d.okved) { $d.okved } else { 'услуги' }
  $okvedShort = if ($okved.Length -gt 60) { $okved.Substring(0, 60) + '…' } else { $okved }
  $city = if ($d.city) { $d.city } else { 'городе' }
  $svc = Guess-Services $okved
  $phone = if ($d.phone) { $d.phone } else { '+7 ___ ___-__-__' }

  $map = @{
    '{{COMPANY}}' = $name
    '{{COMPANY_SHORT}}' = $short
    '{{CITY}}' = $city
    '{{OKVED}}' = $okved
    '{{OKVED_SHORT}}' = $okvedShort.ToLower()
    '{{LEAD}}' = ("{0} работает в городе {1}: " -f $short, $city) + (Guess-Lead $okved)
    '{{PHONE}}' = $phone
    '{{EMAIL}}' = $(if ($d.email) { $d.email } else { 'info@example.ru' })
    '{{ADDRESS}}' = "адрес компании (уточняется)"
    '{{SERVICE_1}}' = $svc[0]; '{{SERVICE_1_TEXT}}' = (Guess-Text $svc[0] $okved)
    '{{SERVICE_2}}' = $svc[1]; '{{SERVICE_2_TEXT}}' = (Guess-Text $svc[1] $okved)
    '{{SERVICE_3}}' = $svc[2]; '{{SERVICE_3_TEXT}}' = (Guess-Text $svc[2] $okved)
    '{{SERVICE_4}}' = $svc[3]; '{{SERVICE_4_TEXT}}' = (Guess-Text $svc[3] $okved)
    '{{PRICE_1}}' = (Rand-Num 800 3000); '{{PRICE_2}}' = (Rand-Num 1200 4500)
    '{{PRICE_3}}' = (Rand-Num 1500 6000); '{{PRICE_4}}' = (Rand-Num 800 4000)
  }
  foreach ($k in $map.Keys) { $html = $html.Replace($k, $map[$k]) }

  $left = @([regex]::Matches($html, '\{\{[A-Z0-9_]+\}\}') | ForEach-Object { $_.Value } | Sort-Object -Unique)
  if ($left.Count -gt 0) { Write-Host ("  ВНИМАНИЕ {0}: не подставлены {1}" -f $d.id, ($left -join ', ')) -ForegroundColor Yellow }

  if ($html -notmatch 'ЭТО ПРИМЕР САЙТА') { throw "в шаблоне нет баннера «ЭТО ПРИМЕР» — вложение опасно отправлять" }

  $slug = ($short -replace '[^\wа-яА-ЯёЁ\-]', '')
  $file = '{0}-example.html' -f $d.id
  $path = Join-Path $outDirPath $file
  [IO.File]::WriteAllText($path, $html, (New-Object Text.UTF8Encoding $false))

  # ---- второй пример: админ-панель (тариф 1000-2000) ----
  $adminFile = ''
  $adminPath = Join-Path $root $AdminTemplate
  if (Test-Path $adminPath) {
    $adm = [IO.File]::ReadAllText($adminPath, [Text.Encoding]::UTF8)
    $admMap = @{
      '{{COMPANY}}' = $name
      '{{COMPANY_SHORT}}' = $short
      '{{COMPANY_SHORT_DOMAIN}}' = ((($name -replace '[^\wа-яА-ЯёЁ]', '').ToLower()) + '.ru')
      '{{SERVICE_1}}' = $svc[0]; '{{SERVICE_2}}' = $svc[1]; '{{SERVICE_3}}' = $svc[2]; '{{SERVICE_4}}' = $svc[3]
    }
    foreach ($k in $admMap.Keys) { $adm = $adm.Replace($k, $admMap[$k]) }
    if ($adm -match '\{\{[A-Z0-9_]+\}\}') { Write-Host ("  ВНИМАНИЕ {0}: в админке остались плейсхолдеры" -f $d.id) -ForegroundColor Yellow }
    if ($adm -notmatch 'ЭТО ПРИМЕР АДМИН-ПАНЕЛИ') { throw "в admin-шаблоне нет баннера «ЭТО ПРИМЕР»" }
    $adminFile = '{0}-admin-example.html' -f $d.id
    [IO.File]::WriteAllText((Join-Path $outDirPath $adminFile), $adm, (New-Object Text.UTF8Encoding $false))
  }

  $made += [pscustomobject]@{
    id = $d.id; company = $name; file = $file; admin_file = $adminFile
    bytes = (Get-Item $path).Length; leftovers = $left.Count
  }
  Write-Host ("  {0}  {1,-30} сайт {2,6:N0} байт{3}" -f $d.id, $short, (Get-Item $path).Length, $(if ($adminFile) { ' + админка' } else { '' }))
}

$made | Export-Csv -Path (Join-Path $outDirPath 'index.csv') -NoTypeInformation -Encoding UTF8
Write-Host ("готово примеров: {0} -> {1}" -f $made.Count, $OutDir)
