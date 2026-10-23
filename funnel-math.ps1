<#
  funnel-math.ps1 — считает экономику волны по НАСТОЯЩИМ числам из проекта.

  Зачем. Все разговоры о деньгах упираются в одно неизвестное: сколько писем
  нужно, чтобы получить одну сделку. Ответ нельзя взять из воздуха, но можно
  посчитать от того, что реально лежит в файлах: сколько лидов собрано, сколько
  писем отправлено, сколько сделок в воронке.

  Скрипт ничего не придумывает: конверсии берутся из переменных с честными
  диапазонами, а не из одной «средней» цифры. Одна средняя цифра враньёт —
  на 690 лидах разница между 1% и 5% отклика это разница между одной сделкой и
  пятью.

  Run:
    powershell -ExecutionPolicy Bypass -File funnel-math.ps1
    powershell -ExecutionPolicy Bypass -File funnel-math.ps1 -ReplyRate 4 -CloseRate 25
#>
[CmdletBinding()]
param(
  [double]$ReplyRate = 0,      # % ответов, 0 = взять диапазон 1..5
  [double]$PositiveRate = 0,    # % ответов, которые ведут в разговор
  [double]$CloseRate = 0,       # % разговоров, которые становятся сделкой
  [int]$Check = 0,              # средний чек, 0 = взять 25..60 тыс
  [int]$DailyPerMailbox = 30
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

function Csv-Count([string]$name) {
  $p = Join-Path $root $name
  if (-not (Test-Path $p)) { return 0 }
  return @(Import-Csv -Path $p -Encoding UTF8 | Where-Object { $_.email -or $_.id }).Count
}

$leads = Csv-Count 'leads-clean.csv'
$sent = 0
$sentPath = Join-Path $root 'sent-log.csv'
if (Test-Path $sentPath) {
  $sent = @(Import-Csv -Path $sentPath -Encoding UTF8 | Where-Object { $_.status -like 'sent*' }).Count
}
$deals = Csv-Count 'deals.csv'

Write-Host '=== что реально есть в проекте ===' -ForegroundColor Cyan
Write-Host ("  лидов в отфильтрованной базе : {0}" -f $leads)
Write-Host ("  писем отправлено              : {0}" -f $sent)
Write-Host ("  сделок в воронке             : {0}" -f $deals)
Write-Host ("  отправлено на 1 лид          : {0:P1}" -f $(if ($leads) { $sent / $leads } else { 0 }))

if ($leads -eq 0) {
  Write-Host ''
  Write-Host 'Лидов нет: считать нечего.' -ForegroundColor Yellow
  exit 1
}

# --- диапазоны, а не одно число ---
$rLo = if ($ReplyRate -gt 0) { $ReplyRate } else { 1.0 }
$rHi = if ($ReplyRate -gt 0) { $ReplyRate } else { 5.0 }
$pLo = if ($PositiveRate -gt 0) { $PositiveRate } else { 30.0 }
$pHi = if ($PositiveRate -gt 0) { $PositiveRate } else { 60.0 }
$cLo = if ($CloseRate -gt 0) { $CloseRate } else { 15.0 }
$cHi = if ($CloseRate -gt 0) { $CloseRate } else { 30.0 }
$kLo = if ($Check -gt 0) { $Check } else { 25000 }
$kHi = if ($Check -gt 0) { $Check } else { 60000 }

Write-Host ''
Write-Host '=== диапазоны конверсий ===' -ForegroundColor Cyan
Write-Host ("  отклик на письмо   : {0:N1} .. {1:N1} %" -f $rLo, $rHi)
Write-Host ("  дошло до разговора : {0:N0} .. {1:N0} %" -f $pLo, $pHi)
Write-Host ("  разговор -> сделка : {0:N0} .. {1:N0} %" -f $cLo, $cHi)
Write-Host ("  чек                : {0:N0} .. {1:N0} руб" -f $kLo, $kHi)
Write-Host '  (это не выдумка, а обычные диапазоны холодной B2B-рассылки; подставь'
Write-Host '   свои -ReplyRate/-PositiveRate/-CloseRate/-Check, когда появятся свои данные)'

Write-Host ''
Write-Host '=== что даёт одна полная волна по всей базе ===' -ForegroundColor Cyan
$repliesLo = [math]::Round($leads * $rLo / 100)
$repliesHi = [math]::Round($leads * $rHi / 100)
$dealsLo = [math]::Floor($repliesLo * $pLo / 100 * $cLo / 100)
$dealsHi = [math]::Floor($repliesHi * $pHi / 100 * $cHi / 100)
$moneyLo = $dealsLo * $kLo
$moneyHi = $dealsHi * $kHi
Write-Host ("  ответов  : {0} .. {1}" -f $repliesLo, $repliesHi)
Write-Host ("  сделок   : {0} .. {1}" -f $dealsLo, $dealsHi)
Write-Host ("  выручка  : {0:N0} .. {1:N0} руб" -f $moneyLo, $moneyHi)

Write-Host ''
Write-Host '=== сколько это дней отправки ===' -ForegroundColor Cyan
$boxes = 3
$perDay = $DailyPerMailbox * $boxes
$days = [math]::Ceiling($leads / $perDay)
Write-Host ("  {0} ящиков по {1} писем = {2} писем в день" -f $boxes, $DailyPerMailbox, $perDay)
Write-Host ("  вся база уходит за {0} дней отправки" -f $days)
Write-Host ("  это {0} писем в неделю, реально осилить без выгорания" -f ($perDay * 5))

Write-Host ''
Write-Host '=== стоимость инфраструктуры в месяц ===' -ForegroundColor Cyan
$domains = 300        # отдельный домен под рассылку, ~200-400 руб/мес
$mailboxes = 0        # свои ящики на бесплатных тарифах Яндекса
$vps = 0              # VPS не нужен, пока SMTP хватает бесплатного
Write-Host ("  домен под рассылку   : {0} руб (разово, потом продление)" -f $domains)
Write-Host ("  почтовые ящики       : {0} руб (свои, на бесплатных тарифах)" -f $mailboxes)
Write-Host ("  VPS                  : {0} руб (не нужен на этом этапе)" -f $vps)
Write-Host ("  выручка волны       : {0:N0} .. {1:N0} руб" -f $moneyLo, $moneyHi)

Write-Host ''
Write-Host '=== что из этого следует ===' -ForegroundColor Cyan
Write-Host ('  Инфраструктура тут почти бесплатна. Деньги делает не сервер и не')
Write-Host ('  почтовый ящик, а разговор по телефону. Поэтому покупать VPS,')
Write-Host ('  домены и железо "для рассылки" смысла нет, пока не закрыта сделка.')
Write-Host ''
Write-Host ('  Главный риск не технический: письмо без ответа стоит 0 руб, а письмо')
Write-Host ('  с ответом превращается в 25-60 тыс. Значит весь смысл волны — в')
Write-Host ('  доведении письма до человека, а не в количестве отправленных писем.')
exit 0
