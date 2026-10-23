<#
  bounce-scan.ps1 — разбирает отказ доставки и сам помечает адрес мёртвым.

  Зачем. 19 октября пришло первое реальное возвращение: Gmail отбил
  aspmk@astranet.ru с кодом «550 5.1.1 User unknown». Проверка домена такое
  пропустить не может — домен есть и почту принимает, а ящика нет. Единственный
  источник правды о существовании ящика — ответ почтового сервера. Значит, этот
  ответ надо разбирать автоматически, а не глазами.

  Отказ приходит обычным письмом. Текст копируется и скармливается этому скрипту:

    powershell -ExecutionPolicy Bypass -File bounce-scan.ps1 -File "C:\...\отказ.txt"
    Get-Clipboard | Out-File -Encoding utf8 отказ.txt    # так тоже можно

  Скрипт находит адреса, классифицирует код отказа и вызывает
  pipeline.ps1 bounce, который ставит сделке этап z1 и пишет dead-addresses.csv.

  Коды, которые различаются (всё остальное молча попадает в «непонятный отказ»
  и тоже помечает адрес мёртвым — переотправлять в никуда смысла нет):

    550 5.1.1 / User unknown      ящика нет            → мёртв
    550 5.7.1 / Message rejected  сервер не принимает  → мёртв
    552 / Mailbox full            ящик переполнен      → ЖИВ, ждать
    451 / try again later         временная задержка    → ЖИВ, повторить
    550 5.2.2 / Mailbox disabled  адрес отключён       → мёртв

  Run:
    powershell -ExecutionPolicy Bypass -File bounce-scan.ps1 -File отказ.txt
    powershell -ExecutionPolicy Bypass -File bounce-scan.ps1 -Text "..."
    powershell -ExecutionPolicy Bypass -File bounce-scan.ps1 -Clipboard
#>
[CmdletBinding()]
param(
  [string]$File = '',
  [string]$Text = '',
  [switch]$Clipboard,
  [string]$MyFrom = 'teivrim21@gmail.com',
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

if ($Clipboard) {
  $cb = Get-Clipboard -Raw -ErrorAction SilentlyContinue
  if (-not $cb) { Write-Host 'буфер обмена пуст' -ForegroundColor Red; exit 2 }
  $Text = $cb
}
if (-not $Text -and $File) {
  if (-not (Test-Path $File)) { Write-Host "нет файла: $File" -ForegroundColor Red; exit 2 }
  $Text = [IO.File]::ReadAllText($File, [Text.Encoding]::UTF8)
}
if (-not $Text) {
  $Text = [Console]::In.ReadToEnd()
  if (-not $Text) { Write-Host 'нечего разбирать: дай -File, -Text или -Clipboard' -ForegroundColor Red; exit 2 }
}

# отказ — это обычный текст, но base64-куски встречаются. Раскодируем всё, что
# похоже на base64, иначе адрес внутри вложенного MIME просто не найдётся.
$plain = $Text
foreach ($m in [regex]::Matches($Text, '(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{80,}={0,2}(?![A-Za-z0-9+/=])')) {
  try {
    $bytes = [Convert]::FromBase64String(($m.Value -replace '\s', ''))
    $decoded = [Text.Encoding]::UTF8.GetString($bytes)
    if ($decoded -match '@') { $plain += "`n" + $decoded }
  } catch { }
}

# найти адреса. Основной источник — явные перечисления вида «адрес X не найден».
# Но если текст на английском (серверы Yandex/Mail), в нём бывает только
# «...following address(es) failed: user@host» — тогда берём все адреса подряд.
#
# ГЛАВНОЕ: адрес ОТПРАВИТЕЛЯ не является неудачным получателем. В отказе всегда
# есть цитированное исходное письмо с «From: мой@ящик», и наивный разбор
# помечал мёртвым собственный ящик отправителя. Первый прогон так и сделал:
# aspmk@astranet.ru (настоящий отказ) + teivrim21@gmail.com (мой адрес).
# И наоборот: эвристика «адрес в <скобках> = отправитель» ломала отказы Яндекса,
# где формат «<получатель>: host said: 550 ...» — скобки там у НЕУДАЧНЫХ.
$senders = New-Object System.Collections.ArrayList
foreach ($m in [regex]::Matches($plain, '(?im)^(from|sender|return-path|reply-to|от|отправитель)\s*:\s*.+')) {
  foreach ($a in [regex]::Matches($m.Value, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) {
    [void]$senders.Add($a.Value.ToLower())
  }
}
# Заголовок To: НЕ исключаем: в цитированном исходном письме в нём стоят именно
# те, кто не получил. Раньше он попадал под «отправителя» вместе с From: и
# разбор молча находил 0 адресов на нормальном отказе Яндекса.
foreach ($l in (($plain -split "`r?`n") | Where-Object { $_ -imatch '^\s*from\s*:' })) {
  foreach ($a in [regex]::Matches($l, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) {
    [void]$senders.Add($a.Value.ToLower())
  }
}
# и адрес, с которого мы сами отправляем
$selfMails = New-Object System.Collections.ArrayList
foreach ($u in ($MyFrom -split ',')) {
  $u = $u.Trim()
  if ($u -match '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$') { [void]$selfMails.Add($u.ToLower()) }
}

$addresses = New-Object System.Collections.ArrayList
$skippedSelf = @()
foreach ($m in [regex]::Matches($plain, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) {
  $a = $m.Value.ToLower()
  if ($a -match '\.(png|jpg|jpeg|gif|svg|css|js|woff2?)$') { continue }
  if ($senders -contains $a -or $selfMails -contains $a) { $skippedSelf += $a; continue }
  [void]$addresses.Add($a)
}
$addresses = @($addresses | Select-Object -Unique)

if ($addresses.Count -eq 0) {
  Write-Host 'адресов в тексте отказа не найдено' -ForegroundColor Yellow
  if ($skippedSelf.Count -gt 0) {
    Write-Host ("адреса были, но это отправители, а не получатели: {0}" -f (($skippedSelf | Select-Object -Unique) -join ', ')) -ForegroundColor DarkGray
    Write-Host 'значит отказ чужой или это не отказ доставки' -ForegroundColor Yellow
  }
  Write-Host 'возможные причины: файл не тот, или отказ вложен в .eml — тогда:'
  Write-Host '  выдели письмо целиком в Gmail -> Скачать как .eml -> и скармливай .eml этим скриптом'
  exit 1
}
if ($skippedSelf.Count -gt 0) {
  Write-Host ("пропущены как отправители: {0}" -f (($skippedSelf | Select-Object -Unique) -join ', ')) -ForegroundColor DarkGray
}

# классификация по коду отказа
# ПОРЯДОК ПРАВИЛ РЕШАЕТ ВСЁ. «Живой» и «повторить» проверяются ПЕРВЫМИ.
# На первом прогоне правило «5.2.2 → адрес отключён» стояло раньше правила
# «552 Mailbox full → жив», и Яндексовский код «552 5.2.2 Mailbox full»
# попадал в «отключён»: живой ящик помечался мёртвым. Это опасное направление
# ошибки — оно выкидывает рабочий лид из воронки. Сначала спасаем, потом судим.
$reasons = @(
  # --- сначала то, что адрес ЖИВ ---
  @{ re = 'mailbox\s*full|over\s*quota|quota\s*exceeded|\b552\b|переполн|нет места'; verdict = 'alive';  what = 'ящик переполнен, жив' }
  @{ re = '\b451\b|\b4\d\d\s+\d\.\d\.\d|try\s+again\s+later|try\s+again|throttl|too\s+many\s+requests|temporar|временно|слишком\s+часто'; verdict = 'retry'; what = 'временная задержка, повторить' }
  # --- потом то, что адрес МЁРТВ ---
  @{ re = 'mailbox\s+disabled|disabled\s+in\s+this\s+account|5\.7\.1|message\s+rejected|not\s+accepting\s+(incoming\s+)?messages|отключ[её]н'; verdict = 'dead'; what = 'ящик отключён или сервер не принимает' }
  @{ re = '5\.1\.1|user\s+unknown|recipient\s+address\s+rejected|mailbox\s+does\s+not\s+exist|unknown\s+user|no\s+such\s+user|does\s+not\s+exist|адрес\s+не\s+найден|ящик.*не\s+существ'; verdict = 'dead'; what = 'ящика нет' }
  @{ re = '5\.7\.25|blocked\s+as\s+spam|spam\s+rejected|5\.0\.0|blocked'; verdict = 'dead'; what = 'сервер считает спамом' }
  @{ re = '5\.2\.2|recipient\s+not\s+found'; verdict = 'dead'; what = 'получатель не найден' }
)
function Verdict([string]$all) {
  $l = $all.ToLower()
  foreach ($r in $reasons) {
    if ($l -match $r.re) { return @{ v = $r.verdict; w = $r.what } }
  }
  return @{ v = 'dead'; w = 'непонятный отказ, но повторно слать смысла нет' }
}

# сопоставить адрес со сделкой по доске
$deals = @()
$db = Join-Path $root 'deals.csv'
if (Test-Path $db) { $deals = @(Import-Csv $db) }

Write-Host ''
Write-Host "=== разбор отказа: найдено адресов $($addresses.Count) ===" -ForegroundColor Cyan
$report = @()
$dead = 0; $alive = 0; $retry = 0; $unknown = 0

foreach ($a in $addresses) {
  $ctx = ''
  $hit = @($deals | Where-Object { $_.email -and $_.email.ToLower() -eq $a })
  $verdict = Verdict $ctx
  if ($hit.Count -gt 0) {
    $d = $hit[0]
    $ctx = ('сделка {0}, {1}, этап {2}' -f $d.id, $d.company, $d.stage)
  } else {
    $ctx = 'в воронке не найден'
  }

  # уточняем вердикт по блоку ОТКАЗА, относящемуся именно к этому адресу.
  # Блок начинается с адреса и заканчивается либо пустой строкой, либо началом
  # блока следующего получателя («^<другой@адрес>:»). Раньше окно брало и адрес,
  # и ±200 символов вокруг — и код отказа СЛЕДУЮЩЕГО получателя попадал в
  # вердикт предыдущего. Обрезка с неправильной стороны отрезала сам код.
  $low = $plain.ToLower()
  $ix = $low.IndexOf($a)
  if ($ix -ge 0) {
    $tail = $low.Substring($ix)
    $blank = $tail.IndexOf("`n`n")
    if ($blank -gt 0) { $tail = $tail.Substring(0, $blank) }
    # следующий получащийся блок: новая строка, начинающаяся с <адрес>:
    $after = $tail.Substring(1)
    $nx = [regex]::Match($after, '(?m)^\s*<[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*:')
    if ($nx.Success -and $nx.Index -gt 10) { $tail = $tail.Substring(0, $nx.Index + 1) }
    if ($tail.Length -gt 600) { $tail = $tail.Substring(0, 600) }
    $verdict = Verdict $tail
  }

  $color = 'Yellow'
  if ($verdict.v -eq 'dead') { $color = 'Red' }
  if ($verdict.v -eq 'retry') { $color = 'DarkCyan' }
  Write-Host ("  {0,-32} {1,-8} {2}" -f $a, $verdict.v, $verdict.w) -ForegroundColor $color
  Write-Host ("      {0}" -f $ctx)

  $report += [pscustomobject]@{
    address = $a; verdict = $verdict.v; reason = $verdict.w
    deal = $(if ($hit.Count -gt 0) { $hit[0].id } else { '' })
    company = $(if ($hit.Count -gt 0) { $hit[0].company } else { '' })
  }

  switch ($verdict.v) {
    'dead' { $dead++ }
    'retry' { $retry++ }
    'alive' { $alive++; continue }
  }

  # помечаем мёртвые
  if ($verdict.v -ne 'dead') { continue }
  if ($DryRun) { Write-Host '      (DryRun — этап не меняется)' -ForegroundColor DarkGray; continue }
  if ($hit.Count -gt 0) {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'pipeline.ps1') `
      bounce -Id $hit[0].id -Next $verdict.w -Note ('отказ доставки: ' + $a) 2>&1
    foreach ($l in $out) { Write-Host ('      ' + $l) }
  } else {
    Write-Host '      нет сделки — записать вручную в dead-addresses.csv' -ForegroundColor DarkYellow
  }
}

$rf = Join-Path $root ('bounce-report-{0}.csv' -f (Get-Date -Format 'yyyyMMdd-HHmm'))
$report | Export-Csv -Path $rf -NoTypeInformation -Encoding UTF8
Write-Host ''
Write-Host ("мёртвых: {0}  живых(переполнен): {1}  повторить позже: {2}" -f $dead, $alive, $retry) -ForegroundColor $(if ($dead -gt 0) { 'Red' } else { 'Green' })
Write-Host ("отчёт: {0}" -f (Split-Path $rf -Leaf))
if ($dead -gt 0 -and -not $DryRun) {
  Write-Host ''
  Write-Host 'дальше по каждому из них:' -ForegroundColor Yellow
  foreach ($r in ($report | Where-Object { $_.verdict -eq 'dead' -and $_.deal })) {
    Write-Host ("  {0}  ->  pipeline.ps1 bounce -Id {1} -Next '<код SMTP>'  (уже выполнено)" -f $r.address, $r.deal)
  }
}
if ($dead -gt 0) { exit 3 }
exit 0