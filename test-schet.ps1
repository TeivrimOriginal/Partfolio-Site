<#
  test-schet.ps1 — проверка schet.ps1: контрольные суммы и разница между
  «номером счёта» (документ) и «расчётным счётом» (20 цифр, банк).

  Запуск: powershell -ExecutionPolicy Bypass -File test-schet.ps1
  Работает на временной доске и временных реквизитах в outbox\_test,
  рабочий schet\number.txt не трогает, в конце всё удаляет.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$sc = Join-Path $root 'schet.ps1'
$tmp = Join-Path $root 'outbox\_test'
$tmpDeals = Join-Path $tmp 'deals.csv'
$tmpReq = Join-Path $tmp 'requisites.txt'
$pass = 0; $fail = 0

function Invoke-Schet {
  param([string[]]$SchetArgs)
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $sc @SchetArgs 2>&1
  return [pscustomobject]@{ code = $LASTEXITCODE; text = ($out | Out-String) }
}

function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:pass++; Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("  FAIL  {0}" -f $Name) -ForegroundColor Red }
  if (-not $Ok -and $Detail) { Write-Host ("        {0}" -f ($Detail.Trim() -split "`n" | Select-Object -Last 3 | Out-String).Trim()) -ForegroundColor DarkGray }
}

# ---- контрольные суммы: собираем заведомо верные ИНН и счёт, потом ломаем по одной цифре ----
function Inn10Key {
  param([int[]]$d)
  $w = @(2, 4, 10, 3, 5, 9, 4, 6, 8); $s = 0
  for ($i = 0; $i -lt 9; $i++) { $s += $d[$i] * $w[$i] }
  return ($s % 11) % 10
}
function MakeInn10 { param([string]$first9) $d = @($first9.ToCharArray() | %{ [int]$_ - 48 }); return $first9 + (Inn10Key $d) }
function Inn12Check {
  param([string]$first10)
  $d = @($first10.ToCharArray() | %{ [int]$_ - 48 })
  $a = Inn10Key $d
  $base = $first10 + $a
  $d2 = @($base.ToCharArray() | %{ [int]$_ - 48 })
  $w2 = @(7, 2, 4, 10, 3, 5, 9, 4, 6, 8); $s = 0
  for ($i = 0; $i -lt 10; $i++) { $s += $d2[$i] * $w2[$i] }
  return $base + ((($s % 11) % 10))
}
function Tail3 {
  param([string]$first17)
  $d = @($first17.ToCharArray() | %{ [int]$_ - 48 })
  $w = @(7, 1, 2, 4, 10, 3, 5, 9, 4, 6, 8)
  $out = ''
  foreach ($g in @(0, 1, 2)) {
    $s = 0
    for ($i = 0; $i -lt 3; $i++) { $s += $d[$g * 3 + $i] * $w[$i] }
    $out += [string]($s % 10)
  }
  return $out
}
function MakeRs { param([string]$first17) return $first17 + (Tail3 $first17) }

# ИНН 10-значный из реального открытого реестра (он же лежит в deals.csv, АСПМК-3).
# Формула контрольного числа дополнительно сверена на 14 реальных ИНН из list-org.
$known = '3018000021'
$knownBad = $known.Substring(0, 9) + ([string](([int]$known[9] + 1) % 10))
$inn12 = Inn12Check '5001007322'
$rs = MakeRs '99999810000000000'
$rsBad = $rs.Substring(0, 19) + ([string](([int]$rs[19] + 1) % 10))

Write-Host '=== реквизиты ==='

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

@'
id,stage,stage_entered,next_action_date,next_action,company,inn,city,okved,score,email,phone,source_url,value_rub,prepay_rub,paid_rub,sent_date,reply_date,notes
t001,b3,2026-10-03,2026-10-04,,ТЕСТ ООО,__INN__,Тест,41.20,10,t@t.ru,+70000000000,https://example.invalid,30000,15000,0,,,
t002,a1,2026-10-03,2026-10-03,,ТЕСТ БЕЗ СУММЫ,__INN__,Тест,41.20,10,u@u.ru,+70000000001,https://example.invalid,0,0,0,,,
'@ -replace '__INN__', $known | Set-Content -Path $tmpDeals -Encoding UTF8

$reqGood = @"
name = ИП Тестов Тест Тестович
inn_kpp = $known/1234
rs = $rs
bik = 044525225
bank = ТЕСТ-БАНК
ks = 03070102700000000000
nds = НДС не облагается (УСН, доходы)
"@
$reqBad = @"
name = ИП Тестов Тест Тестович
inn_kpp = $knownBad/1234
rs = $rsBad
bik = 04452522
bank = ТЕСТ-БАНК
ks = 030701027
"@

Set-Content -Path $tmpReq -Value $reqGood -Encoding UTF8

# 1. настоящий ИНН сходится, испорченный — нет
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'ИНН 10 знаков: верный проходит, испорченный падает' ($r.code -eq 0 -and $r.text -match 'всё сходится') $r.text

Set-Content -Path $tmpReq -Value $reqBad -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'битый ИНН / БИК / счёт отвергаются' ($r.text -match "ИНН '.*' — контрольное число не сходится" -and $r.text -match 'БИК .* — не 9 цифр' -and $r.text -match 'контрольные 3 цифры не сходятся') $r.text

# самозанятый: ИНН 12 цифр и БЕЗ КПП. Раньше такой шаблон отвергался — а это самый частый случай.
$inn12 = Inn12Check '5001007322'
$reqSamoz = {
  param([string]$InnKpp)
  return @"
name = Тестов Тест Тестович
inn_kpp = $InnKpp
rs = $rs
bik = 044525225
bank = ТЕСТ-БАНК
ks = 03070102700000000000
"@
}
Set-Content -Path $tmpReq -Value (& $reqSamoz $inn12) -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'самозанятый: ИНН 12 цифр без КПП проходит' ($r.code -eq 0 -and $r.text -match 'всё сходится') $r.text

Set-Content -Path $tmpReq -Value (& $reqSamoz ($inn12 + '/123')) -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'КПП из 3 цифр отвергается (нужно 4 или никак)' ($r.text -match 'ИНН/КПП') $r.text

Set-Content -Path $tmpReq -Value (& $reqSamoz ($inn12 + '/1234')) -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'ИП на УСН: ИНН 12 цифр + /КПП 4 цифры проходит' ($r.code -eq 0 -and $r.text -match 'всё сходится') $r.text

Set-Content -Path $tmpReq -Value (& $reqSamoz ($inn12 + '000')) -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'ИП на ОСНО/патент: ИНН 15 цифр принимается по формату' ($r.code -eq 0 -and $r.text -match 'всё сходится') $r.text

# как в Сбере: поле называется «Номер счёта» — принимаем любые названия ключа
$reqSber = @"
Получатель = Тестов Тест Тестович
инн = $inn12
Номер счёта = $rs
бик = 044525225
банк = ТЕСТ-БАНК
кор_счет = 03070102700000000000
норма_счёта = это значение должно быть отброшено как неизвестное
"@
Set-Content -Path $tmpReq -Value $reqSber -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check '«Номер счёта» из Сбера принимается как расчётный' ($r.code -eq 0 -and $r.text -match 'всё сходится') $r.text

Set-Content -Path $tmpReq -Value ($reqSber -replace "номер_счета = \d+", "номер_счета = $rs") -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'пробел в названии ключа не мешает' ($r.code -eq 0 -and $r.text -match 'всё сходится') $r.text

Set-Content -Path $tmpReq -Value ($reqSber -replace "Номер счёта = \d+", "Номер счёта = 4276380387030001") -Encoding UTF8
$r = Invoke-Schet @('-Check', '-ReqFile', $tmpReq)
Check 'если вписали номер карты (16 цифр) — объясняет где взять счёт' ($r.text -match 'номер КАРТЫ' -and $r.text -match 'Номер счёта.*это и есть расчётный счёт') $r.text

Set-Content -Path $tmpReq -Value $reqGood -Encoding UTF8

Write-Host ''
Write-Host '=== счёт на диск ==='

$r = Invoke-Schet @('-Preview', '-Id', 't001', '-DealsFile', $tmpDeals, '-ReqFile', $tmpReq, '-OutDir', 'outbox\_test\out')
Check '-Preview ничего не пишет и не тратит номер' ($r.code -eq 0 -and -not (Test-Path (Join-Path $tmp 'out'))) $r.text

$r = Invoke-Schet @('-Id', 't001', '-DealsFile', $tmpDeals, '-ReqFile', $tmpReq, '-OutDir', 'outbox\_test\out')
$doc1 = Join-Path $tmp ('out\t001-счёт-{0}.txt' -f (Get-Date -Format 'yyyy-001'))
Check 'счёт создан' ($r.code -eq 0 -and (Test-Path $doc1)) $r.text

$text = if (Test-Path $doc1) { [IO.File]::ReadAllText($doc1) } else { '' }
Check 'шапка: номер счёта = номер документа' ($text -match ('СЧЁТ НА ОПЛАТУ № \d{4}-001')) $text
Check 'реквизиты: расчётный счёт = 20 цифр и подписан отдельно' ($text -match ('Расчётный счёт \(в банке\)\s*: ' + $rs)) $text
Check 'в реквизитах НЕТ номера документа (путаница исключена)' ($text -notmatch 'Расчётный счёт \(в банке\)\s*: \d{4}-\d{3}') $text
Check 'номер счёта документа не 20-значный' ($text -notmatch 'Номер счёта \(документа\)\s*: \d{20}') $text
Check 'назначение платежа содержит номер счёта, а не расчётный' ($text -match ('Оплата по счёту № \d{4}-001.*ИНН ' + $known)) $text
Check 'назначение платежа не содержит расчётный счёт' ($text -notmatch ('Оплата по счёту[^\r\n]*' + $rs)) $text
Check 'сумма = предоплата 15 000' ($text -match '15\s000') $text

$r = Invoke-Schet @('-Id', 't001', '-DealsFile', $tmpDeals, '-ReqFile', $tmpReq, '-OutDir', 'outbox\_test\out')
$doc2 = Join-Path $tmp ('out\t001-счёт-{0}.txt' -f (Get-Date -Format 'yyyy-002'))
Check 'второй счёт получил следующий номер' ($r.code -eq 0 -and (Test-Path $doc2)) $r.text

$r = Invoke-Schet @('-Id', 't002', '-DealsFile', $tmpDeals, '-ReqFile', $tmpReq, '-OutDir', 'outbox\_test\out')
Check 'сделка без суммы объясняет, что делать' ($r.code -ne 0 -and $r.text -match 'не задана сумма') $r.text

$r = Invoke-Schet @('-Id', 't001', '-Full', '-DealsFile', $tmpDeals, '-ReqFile', $tmpReq, '-OutDir', 'outbox\_test\out')
Check '-Full берёт остаток (30 000 - 0 = 30 000)' ($r.code -eq 0 -and $r.text -match '30\s000') $r.text

# без реквизитов файл не создаётся — чтобы клиент не получил счёт с прочерками
Remove-Item $tmpReq -Force
$r = Invoke-Schet @('-Id', 't001', '-DealsFile', $tmpDeals, '-ReqFile', $tmpReq, '-OutDir', 'outbox\_test\out2')
$count = @(Get-ChildItem (Join-Path $tmp 'out2') -Filter '*-счёт-*.txt' -ErrorAction SilentlyContinue).Count
Check 'без реквизитов счёт не пишется (exit 2)' ($r.code -eq 2 -and $count -eq 0) $r.text

$numAfter = Join-Path $tmp 'out2\number.txt'
Check 'отказ не тратит номер счёта' (-not (Test-Path $numAfter)) 'number.txt создан при отказе'

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host ("passed $pass, failed $fail") -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }