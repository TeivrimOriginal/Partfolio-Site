<#
  test-find-targets.ps1 — проверка отбора целей на фикстурах, без сети.

  Каждый пункт — способ отправить письмо не туда:
    1. корпоративные почты отбираются и сортируются по score
    2. дневная норма режет список (-PerDay)
    3. компания, уже в сделках, повторно не берётся (по ИНН)
    4. почта, уже занята другой сделкой, не берётся
    5. почта из dead-addresses.csv не берётся
    6. вердикт DROP/DEAD не берётся
    7. компания без ИНН не берётся
    8. ТОЛЬКО ЛИЧНАЯ ПОЧТА не берётся, а уходит в needs-manual.csv с причиной
    9. -AllowFreeMail включает личные обратно (осознанный выбор, не забывка)
   10. DryRun не трогает deals.csv и не создаёт needs-manual.csv
   11. реальный прогон добавляет сделки на a1 с датой сегодня
   12. пустой источник -> код 3 с объяснением, а не пустой отчёт
   13. нет свежих целей -> код 3 и прямое объяснение, а не тишина
   14. файл волны содержит столько строк, сколько взято целей

  Тест изолирован: копии find-targets.ps1 и pipeline.ps1 во временной папке,
  боевые deals.csv и dead-addresses.csv не трогаются.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
$diagFile = Join-Path $root 'find-targets-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

$tmp = Join-Path $env:TEMP ('ftgt-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$dir = Join-Path $tmp 'work'
New-Item -ItemType Directory -Path (Join-Path $dir 'outbox') -Force | Out-Null
Copy-Item -Path (Join-Path $root 'find-targets.ps1') -Destination (Join-Path $dir 'find-targets.ps1') -Force
Copy-Item -Path (Join-Path $root 'pipeline.ps1') -Destination (Join-Path $dir 'pipeline.ps1') -Force

$cols = @('id', 'stage', 'stage_entered', 'next_action_date', 'next_action', 'company', 'inn', 'city',
  'okved', 'score', 'email', 'phone', 'source_url', 'value_rub', 'prepay_rub', 'paid_rub',
  'sent_date', 'reply_date', 'notes')

function New-Deals([string[]]$Rows) {
  @($cols -join ',') + $Rows | Set-Content -Path (Join-Path $dir 'deals.csv') -Encoding UTF8
}
function Run-Find([string[]]$ScriptArgs) {
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'find-targets.ps1') @ScriptArgs 2>&1
  return @{ text = ($out | Out-String); code = $LASTEXITCODE }
}
# строки лидов: name,inn,city,region,okved,score,email_best,email_free,phone,domain,verdict,url
$lCols = @('name', 'inn', 'city', 'region', 'okved', 'score', 'email_best', 'email_free', 'phone', 'domain', 'verdict', 'url')
function Set-Leads([object[]]$Rows) {
  $out = @($lCols -join ',')
  foreach ($r in $Rows) { $out += $r }
  $out | Set-Content -Path (Join-Path $dir 'leads.csv') -Encoding UTF8
}
function L([string]$name, [string]$inn, [string]$score, [string]$best, [string]$free, [string]$verdict = 'KEEP - unverified, re-check later') {
  return ($lCols | ForEach-Object {
      $v = switch ($_) {
        'name' { $name } 'inn' { $inn } 'score' { $score } 'email_best' { $best }
        'email_free' { $free } 'verdict' { $verdict } 'city' { 'Тестово' } 'url' { 'https://checko.ru/company/x' }
        default { '' }
      }
      '"' + ($v -replace '"', '""') + '"'
    }) -join ','
}

Write-Host '=== find-targets: отбор целей ==='

# --- 1-2: сортировка и дневная норма ---
New-Deals @('d001,a1,2026-10-01,2026-10-01,отправить письмо,Старая,,,,,,,,,,,,,,,')
Set-Leads @(
  (L 'Низкий' '1111111111' '20' 'info@low.ru' ''),
  (L 'Высокий' '2222222222' '90' 'info@high.ru' ''),
  (L 'Средний' '3333333333' '55' 'office@mid.ru' ''),
  (L 'Личная' '4444444444' '99' '' ' chelovek@mail.ru')
)
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '2', '-DryRun')
Check 'корпоративные почты отбираются' ($r.text -match 'Высокий' -and $r.text -match 'Средний') 'не выбраны'
Check 'линяя почта не берётся' ($r.text -notmatch 'chelovek@mail\.ru.*\[') 'личная почта попала в выборку'
Check 'сортировка по score' ($r.text.IndexOf('Высокий') -lt $r.text.IndexOf('Средний')) 'порядок не по score'
Check 'дневная норма режет список' (([regex]::Matches($r.text, '(?m)^\s+\d{10}\s')).Count -eq 2) ('взято: ' + ([regex]::Matches($r.text, '(?m)^\s+\d{10}\s')).Count)
Check 'в отчёте виден отсев' ($r.text -match 'отсеяно:') 'нет строки отсева'

# --- 8: только личная почта -> needs-manual ---
$manualPath = Join-Path $dir 'needs-manual.csv'
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '5', '-DryRun')
Check 'DryRun не создаёт needs-manual.csv' (-not (Test-Path $manualPath)) 'файл создан в DryRun'
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '5')
$mRows = @()
if (Test-Path $manualPath) { $mRows = @(Import-Csv $manualPath -Encoding UTF8) }
Check 'ливая почта попадает в needs-manual' (@($mRows | Where-Object { $_.inn -eq '4444444444' }).Count -eq 1) ('строк: ' + $mRows.Count)
Check 'в needs-manual есть причина' ((@($mRows)[0].reason -match '152-ФЗ') -or ($mRows.Count -eq 0)) 'нет причины'

# --- 9: -AllowFreeMail возвращает личные обратно ---
Remove-Item $manualPath -Force -ErrorAction SilentlyContinue
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '5', '-AllowFreeMail', '-DryRun')
Check '-AllowFreeMail включает личные' ($r.text -match 'chelovek@mail\.ru') 'личная почта не взята даже с флагом'

# --- 3-7: фильтры ---
New-Deals @(
  'd001,a1,2026-10-01,2026-10-01,отправить письмо,Уже есть,7777777777,,,,sold@used.ru,,,,,,,,,,',
  'd002,a1,2026-10-01,2026-10-01,отправить письмо,Почта занята,,,,,busy@busy.ru,,,,,,,,,,'
)
@(
  (@('email', 'id', 'company', 'inn', 'smtp', 'bounced_at', 'sent_at') -join ',')
  'dead@dead.ru,d003,Мёртвая,8888888888,550 5.1.1,2026-10-01 10:00:00,2026-10-01'
) | Set-Content -Path (Join-Path $dir 'dead-addresses.csv') -Encoding UTF8
Set-Leads @(
  (L 'Уже есть' '7777777777' '99' 'sold@used.ru' ''),
  (L 'Почта занята' '9999999999' '98' 'busy@busy.ru' ''),
  (L 'Мёртвая' '8888888888' '97' 'dead@dead.ru' ''),
  (L 'Вычеркнута' '1212121212' '96' 'info@drop.ru' '' 'DROP - исключена проверкой'),
  (L 'Без ИНН' 'не-инн' '95' 'info@noid.ru' ''),
  (L 'Хорошая' '1313131313' '50' 'info@good.ru' '')
)
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '9', '-DryRun')
Check 'уже в сделках — не берётся' ($r.text -notmatch 'sold@used\.ru') 'повторно взята'
Check 'занятая почта — не берётся' ($r.text -notmatch 'busy@busy\.ru') 'взята чужая почта'
Check 'мёртвый адрес — не берётся' ($r.text -notmatch 'dead@dead\.ru') 'взят мёртвый адрес'
Check 'вердикт DROP — не берётся' ($r.text -notmatch 'info@drop\.ru') 'взята вычеркнутая'
Check 'без ИНН — не берётся' ($r.text -notmatch 'info@noid\.ru') 'взята компания без ИНН'
Check 'нормальная компания взята' ($r.text -match 'info@good\.ru') 'не взята'
Check 'причины отсева названы поимённо' (($r.text -match 'уже в сделках 1') -and ($r.text -match 'почта занята 1') -and ($r.text -match 'почта мертва 1') -and ($r.text -match 'вердикт 1') -and ($r.text -match 'без ИНН 1')) 'счётчики отсева неполны'

# --- 10-11: DryRun и реальное добавление ---
$dealsHash0 = (Get-FileHash (Join-Path $dir 'deals.csv') -Algorithm SHA256).Hash
$null = Run-Find @('-Source', 'leads.csv', '-PerDay', '9', '-DryRun')
Check 'DryRun не меняет deals.csv' ((Get-FileHash (Join-Path $dir 'deals.csv') -Algorithm SHA256).Hash -eq $dealsHash0) 'deals.csv изменён в DryRun'

$before = @(Import-Csv (Join-Path $dir 'deals.csv') -Encoding UTF8).Count
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '9')
$after = @(Import-Csv (Join-Path $dir 'deals.csv') -Encoding UTF8)
Check 'реальный прогон добавил сделку' ($after.Count -eq $before + 1) ("было=$before стало=" + $after.Count)
$newDeal = @($after | Where-Object { $_.inn -eq '1313131313' })[0]
if ($newDeal) {
  Check 'новая сделка на этапе a1' ($newDeal.stage -eq 'a1') $newDeal.stage
  Check 'дата действия — сегодня' ($newDeal.next_action_date -eq (Get-Date -Format 'yyyy-MM-dd')) $newDeal.next_action_date
  Check 'почта в сделке из источника' ($newDeal.email -eq 'info@good.ru') $newDeal.email
  Check 'ИНН перенесён' ($newDeal.inn -eq '1313131313') $newDeal.inn
} else {
  Check 'новая сделка на этапе a1' $false 'сделки с ИНН 1313131313 нет'
  Check 'дата действия — сегодня' $false 'нет сделки'
  Check 'почта в сделке из источника' $false 'нет сделки'
  Check 'ИНН перенесён' $false 'нет сделки'
}
$wave = @(Import-Csv (Join-Path $dir 'outbox\targets-wave.csv') -Encoding UTF8 | Where-Object { $_.inn })
Check 'файл волны содержит взятые цели' ($wave.Count -eq 1 -and $wave[0].inn -eq '1313131313') ('строк: ' + $wave.Count)

# --- 12: пустой источник ---
'' | Set-Content -Path (Join-Path $dir 'empty.csv') -Encoding UTF8
$r = Run-Find @('-Source', 'empty.csv', '-DryRun')
Check 'пустой источник -> код 3' ($r.code -eq 3) ('exit=' + $r.code)
Check 'пустой источник объяснён' ($r.text -match 'Без целей автопрогон') 'нет объяснения'
$r = Run-Find @('-Source', 'net-takogo.csv', '-DryRun')
Check 'нет файла источника -> код 3' ($r.code -eq 3) ('exit=' + $r.code)

# --- 13: свежих целей нет ---
Set-Leads @((L 'Уже есть' '7777777777' '99' 'sold@used.ru' ''))
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '3', '-DryRun')
Check 'нет свежих целей -> код 3' ($r.code -eq 3) ('exit=' + $r.code)
Check 'сказано, что письма всё равно уйдут на follow-up' ($r.text -match 'follow-up') 'не сказано про follow-up'
$r = Run-Find @('-Source', 'leads.csv', '-PerDay', '3', '-Collect', '-DryRun')
Check 'при -Collect предложен сборщик' ($r.text -match 'сборщик') 'сборщик не предложен'

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -gt 0) {
  $fails -join "`r`n" | Set-Content -Path $diagFile -Encoding UTF8
  Write-Host ("FAIL {0} / PASS {1}  (подробности: {2})" -f $fail, $pass, $diagFile)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
