<#
  find-targets.ps1 — «само ищет»: набирает свежие цели в воронку.

  Зачем. Автопрогон умеет готовить письма, проверять и отправлять, но цели
  кончились: в noweb-leads-verified.csv шесть компаний, и все шесть уже в
  deals.csv. Пока новых целей нет, «само отправляет» означает «не отправляет
  ничего». Этот скрипт закрывает дыру — набирает цели из проверенной базы и
  добавляет их в воронку на этап a1.

  Правило, которое стоит дороже всего остального: ЛИЧНЫЕ ПОЧТЫ НЕ БЕРУТСЯ.
  Замеренный факт: d002-d006 ушли на freemail (52048-2012@mail.ru,
  baranova-1962@mail.ru, land7777@yandex.ru, magazinruss00@mail.ru) — ноль
  ответов, а адреса вида baranova-1962@ похожи на персональные данные физлица,
  то есть это ещё и 152-ФЗ. Компании без корпоративного домена попадают не в
  воронку, а в needs-manual.csv с причиной: решение по ним — человека.

  Ещё два фильтра, оба из замеров, а не из осторожности:
    - verdict DROP/DEAD — компания вычеркнута проверкой, второй раз не берём
    - адрес из dead-addresses.csv — почтовый сервер уже сказал «ящика нет»

  Run:
    powershell -ExecutionPolicy Bypass -File find-targets.ps1 -PerDay 3 -DryRun
    powershell -ExecutionPolicy Bypass -File find-targets.ps1 -PerDay 3
    powershell -ExecutionPolicy Bypass -File find-targets.ps1 -Collect
#>
[CmdletBinding()]
param(
  [string]$Source = 'noweb-leads-verified.csv',
  [string[]]$ExtraSources = @(),
  [int]$PerDay = 3,
  [switch]$CheckMx,
  [switch]$AllowFreeMail,      # включай осознанно: личные почты дали 0 ответов
  [switch]$Collect,            # если свежих целей нет — запустить сборщик
  [int]$CollectBudget = 200,
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

# freemail-домены: письмо на такой адрес — это не «компания без сайта», это
# «человек, которому мы пишем в личную почту»
$FREE = @('mail.ru', 'yandex.ru', 'yandex.com', 'bk.ru', 'inbox.ru', 'list.ru',
  'rambler.ru', 'gmail.com', 'ya.ru', 'outlook.com', 'hotmail.com', 'mail.com',
  'icloud.com', 'aol.com', 'yandex.com')

function Full([string]$p) { if ([IO.Path]::IsPathRooted($p)) { return $p } else { return (Join-Path $root $p) } }
function Read-Csv([string]$p) {
  if (-not (Test-Path $p)) { return @() }
  try { return @(Import-Csv -Path $p -Encoding UTF8) } catch { return @() }
}
function Is-Free([string]$mail) {
  if (-not $mail -or $mail -notmatch '@') { return $true }
  $dom = ($mail -split '@')[-1].ToLower()
  return ($FREE -contains $dom)
}

$dealsPath = Full 'deals.csv'
$deadPath = Full 'dead-addresses.csv'
$manualPath = Full 'needs-manual.csv'
$wavePath = Full 'outbox\targets-wave.csv'

Write-Host '=== подбор целей ===' -ForegroundColor Cyan

# --- уже занятое ---
$usedInn = @{}
$usedMail = @{}
foreach ($d in (Read-Csv $dealsPath)) {
  if ($d.inn) { $usedInn[($d.inn + '').Trim()] = $true }
  if ($d.email) { $usedMail[($d.email + '').Trim().ToLower()] = $true }
}
$deadMail = @{}
foreach ($x in (Read-Csv $deadPath)) { if ($x.email) { $deadMail[$x.email.ToLower()] = $true } }

# --- читаем источники ---
$rows = @()
foreach ($s in (@($Source) + $ExtraSources)) {
  $p = Full $s
  $got = Read-Csv $p
  Write-Host ("  источник {0}: {1} строк" -f (Split-Path $p -Leaf), $got.Count)
  $rows += $got
}
if ($rows.Count -eq 0) {
  Write-Host ("ИСТОЧНИК ПУСТ или не найден: " + (Split-Path (Full $Source) -Leaf)) -ForegroundColor Yellow
  Write-Host 'Без целей автопрогон отправит только follow-up по уже начатым сделкам.' -ForegroundColor Yellow
  exit 3
}

# --- фильтры ---
$cand = New-Object System.Collections.ArrayList
$manual = New-Object System.Collections.ArrayList
$seen = @{}
$skipInn = 0; $skipMail = 0; $skipDead = 0; $skipVerdict = 0; $skipNoInn = 0; $skipFree = 0

foreach ($r in $rows) {
  $inn = (($r.inn + '') + '').Trim()
  $name = ($r.name + '').Trim()
  $verdict = (($r.verdict + '') + '').ToLower()

  if ($verdict -match '(^|\b)(drop|dead|die|исключ)') {
    $skipVerdict++
    continue
  }
  if ($inn -notmatch '^\d{10}(\d{2})?$') { $skipNoInn++; continue }
  if ($usedInn.ContainsKey($inn)) { $skipInn++; continue }

  # почта: сперва корпоративная, личная — только по явному разрешению
  $best = ''
  foreach ($m in (($r.email_best + '') -split '\|')) {
    $m = $m.Trim()
    if ($m -match '@' -and -not (Is-Free $m)) { $best = $m; break }
  }
  $freeOnly = ''
  if (-not $best) {
    $cands = @(foreach ($m in (($r.email_best + ' ' + $r.email_free) -split '[\|\s]')) {
        $m = ($m + '').Trim()
        if ($m -match '@') { $m }
      })
    if ($cands.Count -gt 0) { $freeOnly = ($cands | Select-Object -First 1) }
  }
  if (-not $best) {
    if ($AllowFreeMail -and $freeOnly) {
      $best = $freeOnly
    } else {
      if ($freeOnly -and -not $usedMail.ContainsKey($freeOnly.ToLower())) {
        [void]$manual.Add([pscustomobject]@{
            checked_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
            name = $name; inn = $inn; city = ($r.city + '').Trim()
            email = $freeOnly
            reason = 'только личная почта, корпоративного домена нет. Отклик на такие не измерен (0 из 5), плюс риск 152-ФЗ. Решение — человека.'
            url = ($r.url + '').Trim()
          })
      }
      $skipFree++
      continue
    }
  }
  $low = $best.ToLower()
  if ($deadMail.ContainsKey($low)) { $skipDead++; continue }
  if ($usedMail.ContainsKey($low)) { $skipMail++; continue }

  $key = 'i' + $inn
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true

  [void]$cand.Add([pscustomobject]@{
      name = $name; inn = $inn; city = ($r.city + '').Trim(); region = ($r.region + '').Trim()
      okved = ($r.okved + '').Trim(); score = [int](($r.score + '0'))
      email_best = $best; email_free = ''; phone = (($r.phone + '') -split '\|')[0].Trim()
      domain = (($r.domain + '') + '').Trim(); url = ($r.url + '').Trim()
      revenue = ($r.revenue + '').Trim()
    })
}

Write-Host ("  отсеяно: вердикт {0}, без ИНН {1}, уже в сделках {2}, почта занята {3}, почта мертва {4}, только личная {5}" -f `
  $skipVerdict, $skipNoInn, $skipInn, $skipMail, $skipDead, $skipFree)

# --- MX по желанию: без проверки можно отправить в никуда ---
if ($CheckMx) {
  $kept = New-Object System.Collections.ArrayList
  $badMx = 0
  foreach ($c in $cand) {
    $dom = ($c.email_best -split '@')[-1]
    $okMx = $false
    try { $okMx = ([Net.Dns]::GetHostEntry($dom)).AddressList.Count -gt 0 } catch { $okMx = $false }
    if ($okMx) { [void]$kept.Add($c) } else { $badMx++ }
  }
  Write-Host ("  MX не резолвится: {0} — отброшены" -f $badMx)
  $cand = $kept
}

# --- сортировка и ограничение дневной нормы ---
$ordered = @($cand | Sort-Object -Property @{ Expression = { [int]$_.score }; Descending = $true })
$take = @($ordered | Select-Object -First $PerDay)

Write-Host ''
if ($take.Count -eq 0) {
  Write-Host 'СВЕЖИХ ЦЕЛЕЙ НЕТ' -ForegroundColor Yellow
  Write-Host ("  всего в источниках: {0}, прошли фильтры: {1}" -f $rows.Count, $ordered.Count) -ForegroundColor Yellow
  if ($manual.Count -gt 0) {
    Write-Host ("  в needs-manual.csv ушло: {0} (только личная почта)" -f $manual.Count) -ForegroundColor DarkYellow
  }
  Write-Host '  Автопрогон сегодня отправит только follow-up по уже начатым сделкам.' -ForegroundColor Yellow
  if ($Collect) {
    $collector = Join-Path $root 'collector.ps1'
    if (-not (Test-Path $collector)) { Write-Host '  сборщик не найден, искать нечем' -ForegroundColor Red; exit 3 }
    Write-Host ("  запускаю сборщик в фоне, бюджет {0} страниц. Он идёт с троттлингом: checko отвечает 429 при burst, поэтому цели появятся не сразу." -f $CollectBudget) -ForegroundColor Cyan
    if (-not $DryRun) {
      Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $root -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'collector.ps1', '-Budget', "$CollectBudget"
      ) | Out-Null
    }
  }
  exit 3
}

# --- пишем волну и добавляем в воронку ---
New-Item -ItemType Directory -Path (Split-Path $wavePath -Parent) -Force | Out-Null
$waveCols = @('name', 'inn', 'city', 'region', 'okved', 'score', 'email_best', 'email_free', 'phone', 'domain', 'url', 'revenue')
($waveCols -join ',') | Set-Content -Path $wavePath -Encoding UTF8
foreach ($t in $take) {
  $vals = @()
  foreach ($c in $waveCols) { $vals += ('"' + (($t.$c + '') -replace '"', '""') + '"') }
  ($vals -join ',') | Add-Content -Path $wavePath -Encoding UTF8
}
Write-Host ("готово целей к добавлению: {0} -> {1}" -f $take.Count, (Split-Path $wavePath -Leaf))
foreach ($t in $take) {
  Write-Host ("  {0}  {1}  {2}  score={3}" -f $t.inn, $t.name, $t.email_best, $t.score) -ForegroundColor Green
}

if ($manual.Count -gt 0 -and -not $DryRun) {
  $mh = 'checked_at,name,inn,city,email,reason,url'
  if (-not (Test-Path $manualPath)) { $mh | Set-Content -Path $manualPath -Encoding UTF8 }
  $manual | Export-Csv -Path $manualPath -NoTypeInformation -Encoding UTF8 -Append
  Write-Host ("  в needs-manual.csv записано: {0} — решение по ним вручную" -f $manual.Count) -ForegroundColor DarkYellow
}

if ($DryRun) {
  Write-Host 'DryRun: файл волны записан на пробу, deals.csv не тронут'
  exit 0
}

$before = @(Read-Csv $dealsPath).Count
$o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'pipeline.ps1') add -Source 'outbox\targets-wave.csv' 2>&1
foreach ($l in @($o | Out-String -Width 160 -Stream | Where-Object { $_.Trim() } | Select-Object -First 3)) { Write-Host ('  ' + $l.Trim()) }
$after = @(Read-Csv $dealsPath).Count
Write-Host ("  сделок было {0}, стало {1}" -f $before, $after)
if ($after -le $before) { Write-Host '  ВНИМАНИЕ: новых сделок не появилось — проверь pipeline.ps1 add' -ForegroundColor Yellow }
exit 0
