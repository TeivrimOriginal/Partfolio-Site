<#
  filter-noweb.ps1
  Turns raw crawled rows into the actual sales base. Collection and filtering are
  separated on purpose: checko.ru throttles hard (measured: 429 after a burst of
  ~40-60 requests), so re-scoring must never require re-crawling.

  Inputs (either one):
    -RawCsv   a CSV produced by build-noweb-base.ps1 (raw per-company parse)
    -Cache    the jsonl resume cache (same objects, one json per line)
  Defaults to the cache, falling back to the raw CSV.

  Keeps a row only when ALL of these hold:
    1) the company is alive ("Действующая компания/организация")
    2) it is a COMMERCIAL legal form (ООО / АО / ИП / КФХ / кооператив / ТСЖ ...)
       - v1 measured 50% of registry pages are schools, hospitals and municipal
         budgets; those never buy a website
    3) it has NO website of its own on checko ("Веб-сайт: —")  <- the pitch
    4) it publishes at least one e-mail  <- how we can reach it

  Score (for call order): revenue, business-grade vs free mail, MSP registry,
  reachable phone, socials-instead-of-site, company age.

  Run:
    powershell -ExecutionPolicy Bypass -File filter-noweb.ps1
#>
[CmdletBinding()]
param(
  [string]$RawCsv = '',
  [string]$Cache = 'noweb-cache.jsonl',
  [string]$OutPrefix = 'noweb'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$rows = @()

function Load-Csv($p) {
  $out = @()
  foreach ($r in (Import-Csv $p)) { $out += $r }
  return $out
}
function Load-Cache($p) {
  $out = @()
  foreach ($line in [IO.File]::ReadAllLines($p)) {
    if (-not $line) { continue }
    try { $out += ($line | ConvertFrom-Json) } catch { }
  }
  return $out
}

if ($RawCsv) {
  $p = if ([IO.Path]::IsPathRooted($RawCsv)) { $RawCsv } else { Join-Path $root $RawCsv }
  if (-not (Test-Path $p)) { throw "no raw csv: $p" }
  $rows = Load-Csv $p
  Write-Host "raw csv rows: $($rows.Count)"
} else {  $p = Join-Path $root $Cache
  if (Test-Path $p) {
    $rows = Load-Cache $p
    Write-Host "cache rows: $($rows.Count)"
  } else {
    $p = Join-Path $root 'noweb-all.csv'
    if (-not (Test-Path $p)) { throw "nothing to filter: no $Cache and no noweb-all.csv" }
    $rows = Load-Csv $p
    Write-Host "fallback noweb-all.csv rows: $($rows.Count)"
  }
}

# ---------------------------------------------------------------- filters
$free = 'mail\.ru|yandex\.ru|yandex\.com|yandex\.by|ya\.ru|bk\.ru|bk\.com|inbox\.ru|list\.ru|live\.ru|internet\.ru|rambler\.ru|gmail\.com|ymail\.com|hotmail\.com|outlook\.com|live\.com|icloud\.com|me\.com|proton(mail)?\.(com|me)|tutanota\.|zoho\.com|fastmail\.'
$roles = '^(info|info2|office|mail|contact|hello|hi|sales|sale|zakaz|order|orders|opt|opt2|b2b|admin|administrator|secretar|secretary|reception|recept|manager|upr|upravlenie|director|marketing|market|buh|buhgal|accounting|vozvrat|shop|internet|www|web|site|kommerch|commercial|partnership|partner|job|hr|resume|vacancy|client|clients|kontakt|kontakty|press|sales-opt)$'
$commercial = 'Общество с ограниченной ответственностью|Акционерное общество|Публичное акционерное|Непубличное акционерное|Индивидуальный предприниматель|Товарищество собственников|Кооператив|Товарищество|Крестьянск|Производственный кооператив'
$nonComm = 'бюджет|автономн|казенн|казённ|учреждени|муниципальн|государственн|министерств|фонд|союз|ассоциац|палат|комитет|инспекци|управлени|служб|администрац|общественн|профсоюз|партия|религиозн|церкв|приход'

function Rev-Mln([string]$s) {
  if (-not $s) { return 0.0 }
  $t = $s -replace '\s', ''
  $mult = 1.0
  if ($t -match 'млрд') { $mult = 1000 } elseif ($t -match 'млн') { $mult = 1 } elseif ($t -match 'тыс') { $mult = 0.001 }
  $num = ($t -replace '[^\d,\.]', '')
  if (-not $num) { return 0.0 }
  $d = 0.0
  if ([double]::TryParse(($num -replace ',', '.'), [ref]$d)) { return [Math]::Round($d * $mult, 2) }
  return 0.0
}

function City-Of([string]$addr) {
  if (-not $addr) { return '' }
  $cand = ''
  $parts = @($addr -split ',\s*')
  for ($i = 0; $i -lt $parts.Count; $i++) {
    $p = $parts[$i].Trim()
    if ($p -match '^(г\.|г |город|с\.|пос\.|пгт\.|сгт\.|поселок|село|деревня)') { $cand = $p; break }
  }
  if (-not $cand) {
    for ($i = 0; $i -lt $parts.Count; $i++) {
      $p = $parts[$i].Trim()
      if ($p -match '(область|край|республика)') { $cand = $p; break }
    }
  }
  if (-not $cand -and $parts.Count -ge 2) { $cand = $parts[1].Trim() }
  if (-not $cand) { return '' }
  # "г. о. город Астрахань" -> "Астрахань"; drop municipal-okrug noise
  $cand = $cand -replace '^\s*(г\.\s*о\.|го\s|г\.о\.|мкр\.?|м\s?н\s?о)\s*', ''
  if ($cand -match '^(г\.|город|с\.)\s+(.+)$') { $cand = $Matches[2] }
  if ($cand -match '^(поселок|село|деревня|пгт|сгт)\s+(.+)$') { $cand = $Matches[2] }
  return ($cand -replace '\s+', ' ').Trim()
}

function Region-Of([string]$addr, [string]$city) {
  if (-not $addr) { return '' }
  foreach ($p in ($addr -split ',\s*')) {
    $p = $p.Trim()
    if ($p -match '^(республика|.*область|.*край|.*округ|Чеченская Республика|Байкал)') { return $p }
  }
  if ($city) { return $city }
  return ''
}

$drop = @{ dead = 0; noncomm = 0; hassite = 0; nomail = 0 }
$scored = @()

foreach ($c in $rows) {
  if (-not $c.name) { continue }
  # status must be checked only when the column exists: the leads/verified
  # exports deliberately do not carry it, and a missing column is NOT "dead"
  if ($c.PSObject.Properties['status'] -and $c.status) {
    if ($c.status -notmatch 'ейств') { $drop.dead++; continue }
  }

  $isComm = ($c.opf -match $commercial) -or ($c.name -match '^\s*(ООО|ОАО|ЗАО|ПАО|АО|ИП|КФХ)\s')
  if (-not $isComm) { $drop.noncomm++; continue }
  if ($c.opf -match $nonComm) { $drop.noncomm++; continue }
  if ($c.website) { $drop.hassite++; continue }

  $mails = @()
  foreach ($m in (($c.email) -split '\|')) {
    $m = $m.Trim().ToLower()
    if ($m -match '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$') { if ($mails -notcontains $m) { $mails += $m } }
  }
  if ($mails.Count -eq 0) { $drop.nomail++; continue }

  $best = @(); $freeM = @()
  foreach ($m in $mails) {
    $dom = ($m -split '@')[1]
    if ($dom -match "^($free)$") { if ($freeM -notcontains $m) { $freeM += $m } }
    elseif ($mails -contains $m) { if ($best -notcontains $m) { $best += $m } }
  }
  # a corporate domain wins even when the local part looks personal
  $why = @()
  $rev = Rev-Mln $c.revenue
  $score = [Math]::Min(40, [Math]::Round($rev / 5))
  if ($best.Count -gt 0) { $score += 25 } else { $score += 8 }
  if ($c.msp -match 'входит в реестр') { $score += 15; $why += 'МСП' }
  if ($c.phone) { $score += 10 } else { $why += 'почта без телефона' }
  if ($c.socials) { $score += 12; $why += 'соцсети вместо сайта' }
  if ($c.regdate -match '(\d{4})') {
    $y = [int]$Matches[1]
    if ($y -lt 2015) { $score += 6; $why += "осн. $y" }
  }
  $why += ('выручка ' + $(if ($c.revenue) { $c.revenue } else { 'н/д' }))

  $city = City-Of $c.address
  $section = ''
  if ($c.okved_code -match '^\s*(\d{1,2})') { $section = $Matches[1] }

  $scored += [pscustomobject]@{
    score = $score
    why = ($why -join ', ')
    name = ($c.name -replace '&quot;', '"')
    opf = $c.opf
    okved = $c.okved
    okved_code = $c.okved_code
    okved_section = $section
    city = $city
    region = (Region-Of $c.address $city)
    address = $c.address
    msp = $c.msp
    revenue = $c.revenue
    revenue_mln = $rev
    regdate = $c.regdate
    capital = $c.capital
    phone = $c.phone
    email_best = ($best -join ' | ')
    email_free = ($freeM -join ' | ')
    socials = $c.socials
    director = $c.director
    inn = $c.inn
    ogrn = $c.ogrn
    url = $c.url
  }
}

$leads = @($scored | Sort-Object -Property score -Descending)
$leadsBest = @($leads | Where-Object { $_.email_best })
$leadsFree = @($leads | Where-Object { -not $_.email_best -and $_.email_free })

# SAFETY: an empty result from a non-empty input means the input is not raw data
# (e.g. someone fed back the already-filtered leads file). Writing that over the
# base destroys it, so refuse and keep the previous files intact.
if ($leads.Count -eq 0 -and $rows.Count -gt 0) {
  Write-Host ''
  Write-Host 'СТОП: из этого файла не получилось ни одного лида.' -ForegroundColor Red
  Write-Host 'Вход уже отфильтрован (нет поля status) либо это другая выгрузка.' -ForegroundColor Red
  Write-Host 'Файлы базы НЕ тронуты. Ожидается сырой разбор из noweb-cache.jsonl / noweb-all.csv.' -ForegroundColor Red
  exit 3
}

function Uniq-Mails($set, $field) {
  $out = @(); $h = @{}
  foreach ($r in $set) {
    foreach ($m in (($r.$field) -split '\|')) {
      $m = $m.Trim().ToLower()
      if (-not $m) { continue }
      if ($m -match '(example|sentry|wixpress|noreply|no-reply|privacy|abuse|dmca|support@|help@|zakupki|kontur|schema|@localhost)') { continue }
      if ($h.ContainsKey($m)) { continue }
      $h[$m] = $true; $out += $m
    }
  }
  return $out
}

$leads | Export-Csv -Path (Join-Path $root "$OutPrefix-leads.csv") -NoTypeInformation -Encoding UTF8
$leadsBest | Export-Csv -Path (Join-Path $root "$OutPrefix-leads-best.csv") -NoTypeInformation -Encoding UTF8
# NOTE: a PowerShell function returning a single item collapses to a scalar, so
# every call must be wrapped in @() or "scalar + array" silently becomes string
# concatenation and the whole mailing list collapses into one line.
$allBest = @(Uniq-Mails $leadsBest 'email_best')
$allFree = @(Uniq-Mails $leadsFree 'email_free')
$allAny = @(@($allBest) + @($allFree) | Sort-Object -Unique)
$allBest | Set-Content -Path (Join-Path $root "$OutPrefix-emails-best.txt") -Encoding UTF8
$allAny | Set-Content -Path (Join-Path $root "$OutPrefix-emails.txt") -Encoding UTF8
$leads | Where-Object { $_.phone } | ForEach-Object {
  '{0}; тел: {1}; {2}; {3}; {4}' -f $_.name, $_.phone, $_.city, $_.okved, $_.revenue
} | Set-Content -Path (Join-Path $root "$OutPrefix-phones.txt") -Encoding UTF8

$stat = @(
  '=== filter-noweb stats ==='
  ("input rows        : {0}" -f $rows.Count)
  ("dropped dead      : {0}" -f $drop.dead)
  ("dropped non-comm  : {0}" -f $drop.noncomm)
  ("dropped has site  : {0}" -f $drop.hassite)
  ("dropped no e-mail : {0}" -f $drop.nomail)
  ("LEADS             : {0}" -f $leads.Count)
  ("  business-grade  : {0}" -f $leadsBest.Count)
  ("  free-mail only  : {0}" -f $leadsFree.Count)
  ("unique e-mails    : {0} total / {1} business-grade" -f $allAny.Count, $allBest.Count)
  ("in MSP registry   : {0}" -f (@($leads | Where-Object { $_.msp -match 'входит в реестр' }).Count))
  ("social not site   : {0}" -f (@($leads | Where-Object { $_.socials }).Count))
  ''
  '--- top 15 by score ---'
)
foreach ($l in ($leads | Select-Object -First 15)) {
  $stat += ('{0,3}  {1}  [{2}]  {3}  {4}' -f $l.score, $l.name, $l.city, $l.why, (($l.email_best, $l.email_free) -join ' '))
}
$stat | Set-Content -Path (Join-Path $root "$OutPrefix-stats.txt") -Encoding UTF8

# ---- segmentation: where the money is, by activity section and region ----
$seg = @()
$grp = @{}
foreach ($l in $leads) {
  $k = '{0}|{1}' -f $l.okved_section, $l.region
  if (-not $grp.ContainsKey($k)) { $grp[$k] = [pscustomobject]@{ okved_section = $l.okved_section; region = $l.region; leads = 0; business_mail = 0; with_phone = 0; revenue_sum = 0.0; best_okved = '' } }
  $g = $grp[$k]
  $g.leads++
  if ($l.email_best) { $g.business_mail++ }
  if ($l.phone) { $g.with_phone++ }
  $g.revenue_sum = [Math]::Round($g.revenue_sum + [double]$l.revenue_mln, 2)
  if ($g.best_okved -eq '' -and $l.okved) { $g.best_okved = $l.okved }
}
foreach ($v in $grp.Values) { $seg += $v }
$seg = @($seg | Sort-Object -Property @{ Expression = { $_.leads }; Descending = $true })
$seg | Export-Csv -Path (Join-Path $root "$OutPrefix-segments.csv") -NoTypeInformation -Encoding UTF8

$stat += ''
$stat += '--- segments by OKVED section ---'
foreach ($g in ($seg | Group-Object okved_section | Sort-Object Count -Descending)) {
  $stat += ('  раздел {0,-3} лидов: {1,-4} бизнес-почта: {2}' -f $g.Name, (($g.Group | Measure-Object leads -Sum).Sum), (($g.Group | Measure-Object business_mail -Sum).Sum))
}
$stat += '--- top regions ---'
foreach ($g in ($seg | Group-Object region | Sort-Object @{ Expression = { ($_.Group | Measure-Object leads -Sum).Sum }; Descending = $true } | Select-Object -First 12)) {
  $stat += ('  {0,-34} лидов: {1}' -f $g.Name, (($g.Group | Measure-Object leads -Sum).Sum))
}
$stat | Set-Content -Path (Join-Path $root "$OutPrefix-stats.txt") -Encoding UTF8

$stat | Select-Object -First 14 | ForEach-Object { Write-Host $_ }
Write-Host "Files: $OutPrefix-leads.csv, $OutPrefix-leads-best.csv, $OutPrefix-segments.csv, $OutPrefix-emails.txt, $OutPrefix-emails-best.txt, $OutPrefix-phones.txt, $OutPrefix-stats.txt"
