<#
  build-send-manifest.ps1 - разбор адресов перед отправкой: ролевой или личный.

  Зачем разбирать: 5 адресов из 6 в текущей базе живут на фримейлах и выглядят
  как личные (baranova-1962@mail.ru, natalya.m@bk.ru). По правилам, записанным
  в NOWEB-BASE.md, на такие адреса холодное письмо хуже всего: это персональные
  данные, отказ человека читается как отказ лично, а не от предложения.
  Но решение остаётся за владельцем базы — скрипт не фильтрует, а показывает.

  Классификация:
    РОЛЕВОЙ   локальная часть = info/sales/zakaz/... или корпоративный домен
    ЛИЧНЫЙ    локальная часть похожа на имя человека (baranova-1962, natalya.m)
    ФРИМЕЙЛ   домен из списка почтовых сервисов, локальная часть нейтральная
    ПРОПУСК   адреса нет

  Run:
    powershell -ExecutionPolicy Bypass -File build-send-manifest.ps1
#>
[CmdletBinding()]
param(
  [string]$Leads = 'noweb-leads-verified.csv',
  [string]$OutFile = 'send-manifest.csv',
  [switch]$NoPersonal
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$leadsPath = Join-Path $root $Leads
if (-not (Test-Path $leadsPath)) { throw "нет $Leads" }

$freeDomains = @('mail.ru', 'yandex.ru', 'yandex.com', 'ya.ru', 'bk.ru', 'bk.com',
  'inbox.ru', 'list.ru', 'live.ru', 'internet.ru', 'rambler.ru', 'gmail.com',
  'outlook.com', 'hotmail.com', 'icloud.com', 'ukr.net', 'i.ua')

$roleLocals = @('info', 'info2', 'office', 'mail', 'contact', 'hello', 'hi', 'sales', 'sale',
  'zakaz', 'order', 'orders', 'opt', 'opt2', 'b2b', 'admin', 'administrator', 'secretar',
  'secretary', 'reception', 'recept', 'manager', 'upr', 'upravlenie', 'director', 'marketing',
  'market', 'buh', 'buhgal', 'accounting', 'vozvrat', 'shop', 'internet', 'www', 'web', 'site',
  'kommerch', 'commercial', 'partnership', 'partner', 'job', 'hr', 'resume', 'vacancy',
  'client', 'clients', 'kontakt', 'kontakty', 'press', 'sales-opt', '24', 'zakaz-opt')

function Kind-Of([string]$mail) {
  if (-not $mail) { return 'ПРОПУСК' }
  $parts = $mail -split '@'
  if ($parts.Count -lt 2) { return 'ПРОПУСК' }
  $loc = $parts[0].ToLower()
  $dom = $parts[1].ToLower()

  $isFree = $freeDomains -contains $dom
  $isRole = $roleLocals -contains $loc
  # Личный вид - только два надёжных признака имени человека:
  #   фамилия-год      baranova-1962, ivanova_1985
  #   имя.отчество/фамилия  natalya.m, ivanova.elena
  # Одиночное слово с цифрами (land7777, magazinruss00, 52048-2012) - это обычно
  # название фирмы или её номер, а не человек. Такое помечаем ФРИМЕЙЛ, иначе
  # нормальные компании ошибочно попадут в «не отправлять».
  $personal = ($loc -match '^[a-z]+[-_.][12][0-9]{3}$') -or ($loc -match '^[a-z]{2,}\.[a-z]{2,}$')

  if (-not $isFree) { return 'РОЛЕВОЙ' }
  if ($isRole) { return 'РОЛЕВОЙ' }
  if ($personal) { return 'ЛИЧНЫЙ' }
  return 'ФРИМЕЙЛ'
}

$rows = @(Import-Csv $leadsPath)
$acc = New-Object System.Collections.ArrayList
foreach ($r in $rows) {
  $m = $r.email_best
  if (-not $m) { $m = ($r.email_free -split '\|')[0] }
  $m = $m.Trim().ToLower()
  $kind = Kind-Of $m
  [void]$acc.Add([pscustomobject]@{
    name = $r.name
    inn = $r.inn
    city = $r.city
    email = $m
    kind = $kind
    email_best = $r.email_best
    email_free = $r.email_free
    phone = $r.phone
    score = $r.score
    source = 'checko.ru (открытый реестр)'
    decision = 'SEND'
  })
}

$list = @($acc)
if ($NoPersonal) { $list = @($list | Where-Object { $_.kind -ne 'ЛИЧНЫЙ' }) }

$list | Export-Csv -Path (Join-Path $root $OutFile) -NoTypeInformation -Encoding UTF8

Write-Host ("адресов: {0}" -f $list.Count)
foreach ($g in ($list | Group-Object kind | Sort-Object Count -Descending)) {
  Write-Host ("  {0,-9} {1}" -f $g.Name, $g.Count)
}
Write-Host ''
foreach ($r in $list) { Write-Host ("  {0,-9} {1,-26} {2}" -f $r.kind, $r.email, $r.name) }

$personal = @($list | Where-Object { $_.kind -eq 'ЛИЧНЫЙ' })
if ($personal.Count -gt 0) {
  Write-Host ''
  Write-Host ("ЛИЧНЫЕ ({0}): похожи на имя человека, а не на компанию." -f $personal.Count) -ForegroundColor Yellow
  Write-Host 'Холодное письмо на такой адрес — это сообщение человеку лично. Решение твоё.'
  Write-Host ('Пересобрать без них: build-send-manifest.ps1 -NoPersonal')
}
Write-Host ''
Write-Host ("Файл: {0}" -f $OutFile)
