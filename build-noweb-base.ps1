<#
  build-noweb-base.ps1  (v2)
  Sales base of Russian COMMERCIAL enterprises that have no website of their own
  (so a website can be offered to them) and whose e-mail is published.

  Source: checko.ru public company pages, enumerated from the sitemap the site
  publishes itself (https://checko.ru/sitemaps/index.xml). robots.txt allows
  /company/* for "User-agent: *"; only /search? is disallowed, so this script
  never touches /search.

  v2 changes vs v1 (measured on a 40-page pilot):
    - only commercial OPF kept (v1 was 50% schools/hospitals/municipal budgets)
    - revenue parsed -> companies able to pay for a site float to the top
    - e-mail split into "best" (corporate domain or role mailbox) vs free mail
    - shards sampled across the whole index for regional mix
    - fetch retries + failure accounting

  PS 5.1 rules that bite here (see NOTES.md):
    - Invoke-WebRequest needs -UseBasicParsing
    - runspace jobs do not inherit TLS settings
    - a .ps1 without UTF-8 BOM is parsed as ANSI -> Cyrillic literals break it
      (re-save with New-Object Text.UTF8Encoding $true after editing)
    - decode response bytes manually, PS 5.1 mangles UTF-8 otherwise

  Run:
    powershell -ExecutionPolicy Bypass -File build-noweb-base.ps1 -Pages 4000
#>
[CmdletBinding()]
param(
  [int]$Pages = 4000,        # company pages to fetch in this run
  [int]$ShardSpan = 1,       # сколько шардов карты тянуть. Одного хватает:
                             # в шарде ~50 000 URL, после отсева по регионам
                             # остаётся ~22 000 — на батч в 50 страниц хватает
                             # с большим запасом. Раньше тянулось 10 шардов
                             # (22 МБ) ради тех же 50 страниц, и именно этот
                             # объём ушёл в бан IP.
  [int]$Throttle = 2,        # parallel workers (checko 429s above ~1.5 req/s)
  [int]$DelayMs = 1200,      # per-worker pause between requests
  [int]$Retries = 3,
  [string]$OutPrefix = 'noweb',
  # Регионы, которые по умолчанию НЕ берём. Коды — это регион из ОГРН
  # (позиции 4-5 в 13-значном номере внутри URL карточки).
  # 77 Москва, 78 Санкт-Петербург, 50 Московская область.
  # Замеренный факт (шард 0055, 49 999 URL): на эти три региона приходится
  # 63.3% реестра. Это крупные компании, у которых сайт есть почти всегда,
  # поэтому случайная выборка по всему реестру давала 6 лидов на 29 страниц.
  # Остальные 36.7% — области и республики, где доля мелкого бизнеса без
  # сайта заметно выше.
  [string]$ExcludeRegions = '77,78,50',
  # Вести учёт отдачи по регионам, чтобы регионы выбирались по данным, а не на глаз
  [switch]$RegionLedger
)

$ErrorActionPreference = 'Continue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function Get-Utf8 {
  param([string]$Url, [int]$Timeout = 90)
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec $Timeout -UseBasicParsing -Headers @{ 'User-Agent' = $UA } -MaximumRedirection 3 -ErrorAction Stop
    try { return [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) } catch { return $r.Content }
  } catch { return $null }
}

# ---------------------------------------------------------------- 1. sitemap
Write-Host 'Reading sitemap index...' -NoNewline
$index = Get-Utf8 'https://checko.ru/sitemaps/index.xml' 120
if (-not $index) { throw 'cannot read sitemap index' }
$shards = @([regex]::Matches($index, '<loc>([^<]*?/organizations/[^<]+)</loc>') | ForEach-Object { $_.Groups[1].Value })
Write-Host " OK, $($shards.Count) organization shards"

# shards are ordered by INN prefix == by region, so spread across the index
$pick = @()
if ($ShardSpan -le 1) { $pick = $shards | Select-Object -First 1 }
else {
  $n = $shards.Count
  for ($i = 0; $i -lt $n -and $pick.Count -lt $ShardSpan; $i++) {
    $pick += $shards[[int][Math]::Round($i * ($n - 1) / [Math]::Max(1, $ShardSpan - 1))]
  }
}

$all = New-Object System.Collections.ArrayList
$smCache = Join-Path $PSScriptRoot '_smcache'
if (-not (Test-Path $smCache)) { New-Item -ItemType Directory -Path $smCache | Out-Null }
foreach ($su in ($pick | Sort-Object -Unique)) {
  $leaf = Split-Path $su -Leaf
  $local = Join-Path $smCache $leaf
  if (Test-Path $local) {
    $u = @([IO.File]::ReadAllLines($local) | Where-Object { $_ })
    foreach ($x in $u) { [void]$all.Add($x) }
    Write-Host ("  shard {0} ... {1} urls (from cache)" -f $leaf, $u.Count)
    continue
  }
  Write-Host ('  shard ' + $leaf + ' ...') -NoNewline
  $xml = Get-Utf8 $su 240
  if (-not $xml) { Write-Host ' FAIL'; continue }
  $u = @([regex]::Matches($xml, '<loc>([^<]+)</loc>') | ForEach-Object { $_.Groups[1].Value })
  [IO.File]::WriteAllLines($local, $u, (New-Object Text.UTF8Encoding $false))
  foreach ($x in $u) { [void]$all.Add($x) }
  Write-Host " $($u.Count) urls (downloaded)"
  Remove-Variable xml -ErrorAction SilentlyContinue
}
Write-Host "Total urls: $($all.Count)"

# ---------------------------------------------------------------- 2. цели
# В URL карточки checko лежит 13-значный ОГРН: 1 | ГГ | РР | счётчик | контрольная.
# То есть год регистрации и регион известны ДО скачивания страницы. Проверено на
# ООО АСПМК-3: ОГРН 1023000838827 -> 2002 год, регион 30 (Астрахань), ИНН 3018...,
# все три источника сходятся.
#
# Замеренный состав одного шарда (0055, 49 999 URL):
#   2025 — 33 656, 2026 — 16 343  => шард целиком из свежих, фильтр по году не нужен
#   77 Москва 16 950 (33.9%), 78 СПб 10 572 (21.1%), столичные всего 63.3%
# Значит отсеивать надо по РЕГИОНУ, а не по году регистрации.
$ex = @($ExcludeRegions -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$rxOgrn = [regex]'-(\d{13})(?:\s|$)'
$urlPool = New-Object System.Collections.ArrayList
$dropped = 0
foreach ($x in $all) {
  $m = $rxOgrn.Match($x)
  if (-not $m.Success) { $dropped++; continue }
  $reg = $m.Groups[1].Value.Substring(3, 2)
  if ($ex -contains $reg) { $dropped++; continue }
  [void]$urlPool.Add($x)
}
Write-Host ("URL in pool: {0}  (skipped by region: {1})" -f $urlPool.Count, $dropped)
if ($urlPool.Count -eq 0) { throw 'после фильтра по регионам не осталось ни одного URL' }

# resume: everything already parsed lives in a jsonl cache, never re-fetch it
$CacheFile = "$OutPrefix-cache.jsonl"
$cached = @()
$done = @{}
if (Test-Path $CacheFile) {
  foreach ($line in [IO.File]::ReadAllLines($CacheFile)) {
    if (-not $line) { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    if (-not $o.url) { continue }
    $cached += $o
    $done[$o.url] = $true
  }
}
if ($done.Count -gt 0) {
  Write-Host "Cache: $($cached.Count) rows already parsed, $($done.Count) urls done"
}
# Цели берём ПОСЛЕ отсева уже собранного. Порядок важен: раньше сначала строились
# ровно $Pages целей, потом из них выбрасывались уже собранные — и с каждым батчем
# оставалось всё меньше, пока батч не схлопывался в ноль при полном кэше.
# Теперь: полный пул минус собранное, потом равномерная выборка $Pages штук.
$remaining = New-Object System.Collections.ArrayList
foreach ($x in $urlPool) { if (-not $done.ContainsKey($x)) { [void]$remaining.Add($x) } }
Write-Host ("Eligible urls: {0}" -f $remaining.Count)
$targets = New-Object System.Collections.ArrayList
if ($remaining.Count -le $Pages) {
  foreach ($x in $remaining) { [void]$targets.Add($x) }
} else {
  # равномерно по всему пулу, а не с начала: список упорядочен по ОГРН, то есть по
  # региону, и выборка с нуля была систематически смещена к первому региону
  $stride = $remaining.Count / [double]$Pages
  for ($k = 0; $k -lt $Pages; $k++) { [void]$targets.Add($remaining[[int][Math]::Floor($k * $stride)]) }
}
Write-Host "Targets: $($targets.Count) (stride $([Math]::Round($remaining.Count / [double]$Pages, 1)))"
if ($targets.Count -eq 0) { Write-Host 'nothing to fetch'; }

# ---------------------------------------------------------------- 2. fetch
$pool = [runspacefactory]::CreateRunspacePool(1, $Throttle)
$pool.Open()
$pending = New-Object System.Collections.ArrayList

foreach ($t in $targets) {
  $ps = [powershell]::Create()
  $ps.AddScript({
    param($url, $ua, $delayMs, $retries)
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
    $h = $null
    $throttled = 0
    for ($try = 0; $try -le $retries -and -not $h; $try++) {
      Start-Sleep -Milliseconds $delayMs
      try {
        $r = Invoke-WebRequest -Uri $url -TimeoutSec 45 -UseBasicParsing -MaximumRedirection 3 -Headers @{ 'User-Agent' = $ua } -ErrorAction Stop
        $h = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
      } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        if ($code -eq 429 -or $code -eq 403) {
          # WAF penalty. Retrying immediately only deepens the block and wastes
          # the batch, so report it once and let the outer collector re-probe later.
          $throttled++
          break
        }
      }
    }
    if (-not $h) { return [pscustomobject]@{ url = $url; failed = $true; throttled = $throttled } }

    function D([string]$s) {
      if (-not $s) { return '' }
      $s = $s -replace '&quot;', '"' -replace '&#34;', '"' -replace '&laquo;', '"' -replace '&raquo;', '"'
      $s = $s -replace '&amp;', '&' -replace '&nbsp;', ' ' -replace '&mdash;', '-' -replace '&ndash;', '-'
      $s = $s -replace '&#\d+;', ' '
      return ($s -replace '\s+', ' ').Trim()
    }
    function M([string]$pattern, [int]$g = 1) {
      $m = [regex]::Match($h, $pattern)
      if ($m.Success) { return (D $m.Groups[$g].Value) }
      return ''
    }

    $name     = M '<h1[^>]*>([^<]{2,220})</h1>'
    $status   = M '<div class="text-(?:success|danger|warning) fw-600">([^<]{3,60})</div>'
    $ogrn     = M 'id="copy-ogrn"[^>]*>(\d{10,15})<'
    $inn      = M 'id="copy-inn"[^>]*>(\d{10,12})<'
    $regdate  = M '>\s*Дата регистрации\s*</div>\s*<div>([^<]{3,40})</div>'
    $okved    = M '>\s*Вид деятельности\s*</div>\s*<div><a[^>]*>([^<]{3,180})</a>'
    $okvedNum = M 'id="activity-name"[^>]*>(\d{1,3}\.[0-9 ]{1,3})<'
    $address  = M 'id="copy-address"[^>]*>([^<]{5,240})<'
    $opf      = M '>\s*Организационно-правовая форма\s*</div>\s*<div>([^<]{3,90})</div>'
    $capital  = M '>\s*Уставный капитал\s*</div>\s*<div>([^<]{2,40})</div>'
    $msp      = M 'малого и среднего предпринимательства\s*</div>\s*<div>([^<]{3,90})</div>'
    $director = M '>\s*Руководитель(?: юридического лица)?\s*</div>\s*<div>([^<]{3,90})</div>'
    $taxes    = M 'Налоги и взносы составили ([0-9][0-9 ,\.]*)'
    $revenueRaw = ''
    $rm = [regex]::Match($h, '>Выручка</a>(?s:.{0,300}?)([0-9][0-9\s.,]*)\s*(млрд|млн|тыс\.?|тысяч)?')
    if ($rm.Success) { $revenueRaw = (D ($rm.Groups[1].Value + ' ' + $rm.Groups[2].Value)) }

    # ---- contacts row ----
    $ci = $h.IndexOf('bs-row gy-3 gx-4 mt-1')
    $row = ''
    if ($ci -ge 0) { $row = $h.Substring($ci, [Math]::Min(3600, $h.Length - $ci)) }
    $emails = @(); $phones = @(); $socials = @(); $site = ''
    if ($row) {
      $emails = @([regex]::Matches($row, 'mailto:([^"''\s>]+)') | ForEach-Object { $_.Groups[1].Value.ToLower() } | Sort-Object -Unique)
      $phones = @([regex]::Matches($row, 'href="tel:([+0-9\-\(\)\s]{7,25})"') | ForEach-Object { $_.Groups[1].Value.Trim() } | Sort-Object -Unique)
      $socials = @([regex]::Matches($row, 'href="(https?://[^"]*(?:vk\.com|instagram\.com|facebook\.com|ok\.ru|t\.me|twitter\.com|youtube\.com|tiktok\.com)[^"]*)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
      $wi = $row.IndexOf('href="http')
      if ($wi -ge 0) {
        $wm = [regex]::Match($row.Substring($wi, [Math]::Min(400, $row.Length - $wi)), 'href="(https?://[^"]+)"')
        if ($wm.Success) {
          $cand = $wm.Groups[1].Value
          if ($cand -notmatch '(checko\.ru|yandex|nalog\.ru|arbitr\.ru|google|mail\.ru|(vk|instagram|facebook|ok)\.|t\.me|twitter|youtube|tiktok)' -and $cand -notmatch '/company/') { $site = $cand }
        }
      }
    }

    [pscustomobject]@{
      failed = $false
      throttled = $throttled
      url = $url; name = $name; status = $status; ogrn = $ogrn; inn = $inn
      regdate = $regdate; okved = $okved; okved_code = $okvedNum; opf = $opf
      capital = $capital; msp = $msp; director = $director; address = $address
      revenue = $revenueRaw; taxes = $taxes
      phone = ($phones -join ' | '); email = ($emails -join ' | ')
      website = $site; socials = ($socials -join ' | ')
    }
  }).AddArgument($t).AddArgument($UA).AddArgument($DelayMs).AddArgument($Retries) | Out-Null
  $ps.RunspacePool = $pool
  [void]$pending.Add(@{ ps = $ps; h = $ps.BeginInvoke() })
}

$rows = New-Object System.Collections.ArrayList
$failed = 0
$throttledPages = 0
$streak = 0
$circuitOpen = $false
$i = 0
foreach ($it in $pending) {
  $i++
  if ($circuitOpen) {
    try { $it.ps.Stop() } catch { }
    $it.ps.Dispose()
    continue
  }
  if ($i % 50 -eq 0) { Write-Progress -Activity 'Crawling' -Status "$i/$($pending.Count)" -PercentComplete (($i / $pending.Count) * 100) }
  while (-not $it.h.IsCompleted) { Start-Sleep -Milliseconds 80 }
  $throttledHere = 0
  try {
    foreach ($r in $it.ps.EndInvoke($it.h)) {
      if (-not $r) { continue }
      if ($r.failed) {
        $failed++
        if ($r.throttled -gt 0) { $throttledPages++; $throttledHere++ }
        continue
      }
      $streak = 0
      if ($r.name) { [void]$rows.Add($r) }
    }
  } catch { }
  $it.ps.Dispose()
  # three throttled pages in a row = the WAF is against us, stop this batch
  if ($throttledHere -gt 0) {
    $streak++
    if ($streak -ge 3) {
      $circuitOpen = $true
      Write-Host "circuit breaker: 3 throttled pages in a row, abandoning the rest of the batch"
    }
  } else { $streak = 0 }
}
Write-Progress -Activity 'Crawling' -Completed
$pool.Close(); $pool.Dispose()
Write-Host "Parsed: $($rows.Count)  failed: $failed  (429/403 seen on $throttledPages pages)"

# persist raw parse to the cache so the next run resumes instead of re-fetching
if ($rows.Count -gt 0) {
  $sw2 = [IO.File]::AppendAllText
  $sb = New-Object Text.StringBuilder
  foreach ($r in $rows) { [void]$sb.AppendLine(($r | ConvertTo-Json -Compress)) }
  [IO.File]::AppendAllText((Join-Path $PSScriptRoot $CacheFile), $sb.ToString(), (New-Object Text.UTF8Encoding $false))
  $rows = @($cached) + @($rows | ForEach-Object { $_ })
  Write-Host "Cache now: $((Get-Content $CacheFile | Measure-Object -Line).Lines) rows"
}

# ---------------------------------------------------------------- 3. dedupe
$seen = @{}; $uniq = @()
foreach ($r in $rows) {
  $k = $r.inn; if (-not $k) { $k = $r.ogrn }; if (-not $k) { $k = $r.url }
  if ($seen.ContainsKey($k)) { continue }
  $seen[$k] = $true
  $uniq += $r
}

$free = 'mail\.ru|yandex\.ru|yandex\.com|yandex\.by|ya\.ru|bk\.ru|bk\.com|inbox\.ru|list\.ru|live\.ru|internet\.ru|rambler\.ru|rampler\.ru|gmail\.com|ymail\.com|hotmail\.com|outlook\.com|live\.com|icloud\.com|me\.com|comcast\.net|proton(mail)?\.(com|me)|tutanota\.|zoho\.com|fastmail\.'
$roles = '^(info|info2|office|mail|contact|hello|hi|sales|sale|zakaz|order|orders|opt|opt2|b2b|admin|administrator|administracia|secretar|secretary|reception|recept|manager|upr|upravlenie|director|marketing|market|buh|buhgal|accounting|vozvrat|support|help|shop|internet|www|web|site|kommerch|commercial|partnership|partner|job|hr|resume|vacancy|zakaz-opt|client|clients|kontakt|kontakty|112|911|press|sales-opt)$'
$commercial = 'Общество с ограниченной ответственностью|Акционерное общество|Публичное акционерное|Непубличное акционерное|Индивидуальный предприниматель|Товарищество собственников|Кооператив|Товарищество|Крестьянск|Производственный кооператив|Общество с ограниченной ответственностью'
$nonComm = 'бюджет|автономн|казенн|казённ|учреждени|муниципальн|государственн|министерств|фонд|союз|ассоциац|палат|комитет|инспекци|управлени|служб|администрац|центр (?:социальн|реабилитац)|общественн|профсоюз|партия|религиозн|церкв|приход'

function Rev-Mln([string]$s) {
  if (-not $s) { return 0.0 }
  $t = $s -replace '\s', ''
  $mult = 1.0
  if ($t -match 'млрд') { $mult = 1000 } elseif ($t -match 'млн') { $mult = 1 } elseif ($t -match 'тыс') { $mult = 0.001 }
  $num = ($t -replace '[^\d,\.]', '')
  if (-not $num) { return 0.0 }
  $num = $num -replace ',', '.'
  $d = 0.0
  if ([double]::TryParse($num, [ref]$d)) { return [Math]::Round($d * $mult, 2) }
  return 0.0
}

$scored = @()
foreach ($c in $uniq) {
  $why = @()
  # 1) must be alive
  if ($c.status -notmatch 'ейств') { continue }
  # 2) must be commercial
  $isComm = ($c.opf -match $commercial) -or ($c.name -match '^\s*(ООО|ОАО|ЗАО|ПАО|АО|ИП|КФХ)\s')
  if (-not $isComm) { continue }
  if ($c.opf -match $nonComm -and $c.opf -notmatch 'Общество') { continue }
  # 3) must have no own website -> the pitch
  if ($c.website) { continue }

  $mails = @()
  foreach ($m in ($c.email -split '\|')) {
    $m = $m.Trim().ToLower()
    if ($m -match '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$') { if ($mails -notcontains $m) { $mails += $m } }
  }
  $best = @(); $freeM = @()
  foreach ($m in $mails) {
    $dom = ($m -split '@')[1]; $loc = ($m -split '@')[0]
    if ($dom -match "^($free)$") { $freeM += $m } elseif ($loc -match $roles) { $best += $m } else { $best += $m }
  }
  $rev = Rev-Mln $c.revenue
  $score = 0
  $score += [Math]::Min(40, [Math]::Round($rev / 5))          # money -> can pay
  if ($best.Count -gt 0) { $score += 25 }                     # reachable by business e-mail
  elseif ($freeM.Count -gt 0) { $score += 8 }
  if ($c.msp -match 'входит в реестр') { $score += 15; $why += 'МСП' }
  if ($c.phone) { $score += 10 }
  if ($c.socials) { $score += 12; $why += 'есть соцсети вместо сайта' }
  if ($c.regdate -match '(\d{4})') { $y = [int]$Matches[1]; if ($y -lt 2015) { $score += 6; $why += "старше 2015 ($y)" } }
  $scored += [pscustomobject]@{
    score = $score
    why = ($why -join ', ')
    name = $c.name
    opf = $c.opf
    okved = $c.okved
    okved_code = $c.okved_code
    msp = $c.msp
    revenue = $c.revenue
    revenue_mln = $rev
    regdate = $c.regdate
    capital = $c.capital
    address = $c.address
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

$leads = @($scored | Where-Object { $_.email_best -or $_.email_free } | Sort-Object -Property score -Descending)
$leadsBest = @($leads | Where-Object { $_.email_best })
$leadsFree = @($leads | Where-Object { -not $_.email_best -and $_.email_free })
$noMail = @($scored | Where-Object { -not $_.email_best -and -not $_.email_free -and $_.phone })

$uniq | Export-Csv -Path "$OutPrefix-all.csv" -NoTypeInformation -Encoding UTF8
$leads | Export-Csv -Path "$OutPrefix-leads.csv" -NoTypeInformation -Encoding UTF8
$leadsBest | Export-Csv -Path "$OutPrefix-leads-best.csv" -NoTypeInformation -Encoding UTF8

function Uniq-Mails($rows, $field) {
  $out = @(); $h = @{}
  foreach ($r in $rows) {
    foreach ($m in ($r.$field -split '\|')) {
      $m = $m.Trim().ToLower()
      if (-not $m) { continue }
      if ($m -match '(example|sentry|wixpress|noreply|no-reply|privacy|abuse|dmca|legal@|support@|help@|zakupki|kontur|schema|@localhost|\.png|\.jpg|@2x)') { continue }
      if ($h.ContainsKey($m)) { continue }
      $h[$m] = $true; $out += $m
    }
  }
  return $out
}

$allBest = @(Uniq-Mails $leadsBest 'email_best')
$allFree = @(Uniq-Mails $leadsFree 'email_free')
$allAny = @(@($allBest) + @($allFree) | Sort-Object -Unique)
$allBest | Set-Content -Path "$OutPrefix-emails-best.txt" -Encoding UTF8
$allAny | Set-Content -Path "$OutPrefix-emails.txt" -Encoding UTF8
$noMail | ForEach-Object { '{0}; тел: {1}; {2}; {3}; выручка: {4}' -f $_.name, $_.phone, $_.address, $_.okved, $_.revenue } |
  Set-Content -Path "$OutPrefix-phones.txt" -Encoding UTF8

$activeAll = @($uniq | Where-Object { $_.status -match 'ейств' })
$stat = @(
  '=== build-noweb-base v2 stats ==='
  ("shards used     : {0}  targets: {1}" -f (@($pick | Sort-Object -Unique).Count), $targets.Count)
  ("parsed / failed : {0} / {1}" -f $rows.Count, $failed)
  ("throttled pages : {0}   cache file: {1}" -f $throttledPages, $CacheFile)
  ("unique          : {0}" -f $uniq.Count)
  ("active          : {0}" -f $activeAll.Count)
  ("active+commercial+no-site : {0}" -f $scored.Count)
  ("  with e-mail   : {0}   (best: {1}, free-mail only: {2})" -f $leads.Count, $leadsBest.Count, $leadsFree.Count)
  ("  phone only    : {0}" -f $noMail.Count)
  ("unique e-mails  : {0} total, {1} business-grade" -f $allAny.Count, $allBest.Count)
  ("social-instead-of-site : {0}" -f (@($leads | Where-Object { $_.socials }).Count))
  ("msp members     : {0}" -f (@($leads | Where-Object { $_.msp -match 'входит в реестр' }).Count))
)
$stat | Set-Content -Path "$OutPrefix-stats.txt" -Encoding UTF8
$stat | ForEach-Object { Write-Host $_ }
Write-Host "Files: $OutPrefix-{all,leads,leads-best}.csv, $OutPrefix-emails.txt, $OutPrefix-emails-best.txt, $OutPrefix-phones.txt, $OutPrefix-stats.txt"
