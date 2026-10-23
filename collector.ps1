<#
  collector.ps1
  Patient driver around build-noweb-base.ps1.

  checko.ru rate-limits by IP: a burst of ~60 requests produced HTTP 429 that was
  still in force 15+ minutes later (measured 15:24 -> 15:37, requests every 90s
  did not clear it). So this driver:
    1) probes with ONE request every ProbeSec until the block lifts
    2) then crawls in small batches at a deliberately low rate (1 worker, 3s gap)
    3) relies on build-noweb-base.ps1's jsonl cache, so every batch is additive
       and nothing is ever fetched twice
    4) stops itself after a page budget or after repeated blocks

  Run (background, no window):
    powershell -ExecutionPolicy Bypass -File collector.ps1 -Budget 3000
#>
[CmdletBinding()]
param(
  [int]$Budget = 3000,      # total company pages to aim for across all batches
  [int]$Batch = 50,         # pages per crawler invocation
  [int]$DelayMs = 3000,     # per-request gap (1 worker => ~20 req/min)
  [int]$ProbeSec = 600,     # первая пауза между проверками, дальше растёт вдвое
  [int]$MaxBackoff = 7200,  # потолок паузы (2 часа)
  [int]$MaxBlockedProbes = 8,
  [string]$LogFile = 'collector.log'
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$log = Join-Path $root $LogFile
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
$Cache = Join-Path $root 'noweb-cache.jsonl'

function Say([string]$m) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Host $line
}

function Cache-Count {
  if (-not (Test-Path $Cache)) { return 0 }
  return (Get-Content $Cache -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
}

function Probe([string]$url) {
  try {
    $r = Invoke-WebRequest -Uri $url -TimeoutSec 30 -UseBasicParsing -Headers @{ 'User-Agent' = $UA } -ErrorAction Stop
    return [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return -1
  }
}

Say ("collector start: budget={0} batch={1} delay={2}ms cached={3}" -f $Budget, $Batch, $DelayMs, (Cache-Count))

$blockedProbes = 0
$batches = 0
$backoff = $ProbeSec
# Список разных карточек для проверки живости. Раньше все 34 пробы шли на ОДНУ
# и ту же карточку aztrubstroy — для их счётчика это выглядит как злоупотребление,
# и именно поэтому бан не снялся за 4 часа. Ротация + растущая пауза честнее.
$ProbeUrls = @(
  'https://checko.ru/company/aztrubstroy-1001601569848',
  'https://checko.ru/company/vestel-1027700193897',
  'https://checko.ru/company/rossiya-1027700193897',
  'https://checko.ru/sitemaps/index.xml'
)
$probeIx = 0
while ($true) {
  $cached = Cache-Count
  if ($cached -ge $Budget) { Say "budget reached ($cached >= $Budget), stopping"; break }

  $code = Probe $ProbeUrls[$probeIx]
  $probeIx = ($probeIx + 1) % $ProbeUrls.Count
  if ($code -ne 200) {
    $blockedProbes++
    Say ("probe -> {0} (blocked probe #{1}) sleeping {2}s (backoff x{3})" -f $code, $blockedProbes, $backoff, [Math]::Round($backoff / $ProbeSec, 1))
    if ($blockedProbes -ge $MaxBlockedProbes) {
      Say ("giving up after {0} probes (~{1:N1} h of backing off). checko bans by IP for hours; run collector.ps1 again much later" -f $blockedProbes, ($backoff * $MaxBlockedProbes / 3600))
      break
    }
    Start-Sleep -Seconds $backoff
    $backoff = [Math]::Min($backoff * 2, $MaxBackoff)
    continue
  }

  $blockedProbes = 0
  $backoff = $ProbeSec
  $batches++
  $want = [Math]::Min($Batch, $Budget - $cached)
  Say ("open: batch #{0}, fetching {1} pages (cache={2})" -f $batches, $want, $cached)
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'build-noweb-base.ps1') `
    -Pages $want -ShardSpan 1 -Throttle 1 -DelayMs $DelayMs -Retries 2 -OutPrefix 'noweb' 2>&1
  foreach ($l in $out) { Say ("  | " + $l) }
  Say ("batch #{0} done, cache={1}" -f $batches, (Cache-Count))
  Start-Sleep -Seconds 20
}

Say ("collector done: batches={0} cache={1}" -f $batches, (Cache-Count))
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'filter-noweb.ps1') | Out-Null
Say 'filter-noweb re-run over the cache'
