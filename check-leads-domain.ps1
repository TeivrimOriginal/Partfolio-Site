<#
  check-leads-domain.ps1
  Validates the "no website" claim for leads whose e-mail sits on a corporate domain.

  Why this matters: checko's "Веб-сайт" field is only what THEY know. A company can
  own a domain that checko never saw, so a lead with e-mail info@firma.ru may in
  fact have a working site - and pitching a site to someone who has one destroys
  the first impression. This script asks the domain itself.

  Classification per domain:
    no_dns     - domain does not resolve at all
    dead_http  - resolves, but nothing answers on 80/443
    parked     - answers, but the page is a parking/placeholder ("перепродается",
                 "coming soon", "domain for sale", tiny body, no <title> content)
    site       - answers with real content -> NOT a lead, flag it
    unknown    - timeout or odd status, keep and re-check later

  No SMTP, no scraping of the site itself: one GET per domain, body not stored.
  Run:
    powershell -ExecutionPolicy Bypass -File check-leads-domain.ps1
#>
[CmdletBinding()]
param(
  [string]$LeadsFile = 'noweb-leads.csv',
  [string]$OutFile = 'noweb-leads-verified.csv',
  [int]$TimeoutSec = 12
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$path = Join-Path $root $LeadsFile
if (-not (Test-Path $path)) { throw "no leads file: $path" }

$leads = @(Import-Csv $path)
Write-Host "leads: $($leads.Count)"

$parkWords = 'перепрода|парк|прода(ется|ётся)|продать|domain (for )?sale|coming soon|under construction|в разработке|заглушк|placeholder|зарезервирован|выберите домен|buy this domain|аукцион'
# RU regional ISP / webmail portals: the site there belongs to the provider,
# not to the company whose e-mail sits on that domain
$portalWords = 'почта|почтовый|портал|интернет-?провайдер|провайдер|хостинг|webmail|вход в почту|почтовый сервис|isp'
$portalDomains = '^(astranet|tenet|obl|volgatech|elnet|nsk|kuzbass|sibnet|qip|沃|smi|vtb-?mail|mail|list|inbox|rambler|yandex|ya|bk|live|internet|ukr\.net|i\.ua)\.'

function Probe-Domain([string]$dom) {
  $res = [ordered]@{ domain = $dom; domain_state = 'unknown'; title = ''; bytes = 0 }
  $ips = @()
  try { $ips = @([Net.Dns]::GetHostAddresses($dom)) } catch { }
  if ($ips.Count -eq 0) { $res.domain_state = 'no_dns'; return [pscustomobject]$res }

  $got = $false
  foreach ($scheme in @('https', 'http')) {
    try {
      $r = Invoke-WebRequest -Uri ("{0}://{1}/" -f $scheme, $dom) -TimeoutSec $TimeoutSec -UseBasicParsing -MaximumRedirection 4 -ErrorAction Stop
      # charset: RU portals still ship windows-1251 while claiming utf-8, so a
      # straight UTF-8 decode turns the title into mojibake and the review is useless
      $bytes = $null
      try { $bytes = $r.RawContentStream.ToArray() } catch { }
      $html = ''
      if ($bytes) { $html = [Text.Encoding]::UTF8.GetString($bytes) } else { $html = [string]$r.Content }
      if ($html -match '(\uFFFD|Ð[\x80-\xBF]|Ñ[\x80-\xBF])') {
        try {
          $alt = [Text.Encoding]::GetEncoding(1251).GetString($bytes)
          if ($alt -notmatch '(\uFFFD|Ð[\x80-\xBF])') { $html = $alt }
        } catch { }
      }
      $title = ''
      $m = [regex]::Match($html, '(?is)<title[^>]*>(.{0,200}?)</title>')
      if ($m.Success) { $title = ($m.Groups[1].Value -replace '\s+', ' ').Trim() }
      $res.title = $title
      $res.bytes = $html.Length
      $flat = ($html -replace '(?s)<[^>]+>', ' ') -replace '\s+', ' '
      if ($title -match $parkWords -or $flat.Substring(0, [Math]::Min(1500, $flat.Length)) -match $parkWords) {
        $res.domain_state = 'parked'
      } elseif ($html.Length -lt 400) {
        $res.domain_state = 'parked'
      } else {
        $res.domain_state = 'site'
      }
      if ($res.domain_state -eq 'site' -and ($dom -match $portalDomains -or $title -match $portalWords)) {
        $res.domain_state = 'portal'
      }
      $got = $true
      break
    } catch {
      $code = 0
      if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
      if ($code -eq 429 -or $code -eq 403) { $res.domain_state = 'unknown'; $got = $true; break }
    }
  }
  if (-not $got) { $res.domain_state = 'dead_http' }
  return [pscustomobject]$res
}

$out = New-Object System.Collections.ArrayList
$domains = @{}
foreach ($l in $leads) {
  $mails = @()
  if ($l.email_best) { $mails += ($l.email_best -split '\|') }
  foreach ($m in $mails) {
    $m = $m.Trim().ToLower()
    if ($m -notmatch '^[^@\s]+@([^@\s]+)$') { continue }
    $d = $Matches[1]
    if ($d -notmatch '^(mail\.ru|yandex\.ru|ya\.ru|bk\.ru|inbox\.ru|list\.ru|rambler\.ru|live\.ru|internet\.ru)$') {
      if (-not $domains.ContainsKey($d)) { $domains[$d] = Probe-Domain $d }
    }
  }
}
Write-Host "corporate domains to probe: $($domains.Count)"

foreach ($l in $leads) {
  $state = ''
  $dom = ''
  if ($l.email_best) {
    foreach ($m in ($l.email_best -split '\|')) {
      $m = $m.Trim().ToLower()
      if ($m -match '^[^@\s]+@([^@\s]+)$') {
        $d = $Matches[1]
        if ($domains.ContainsKey($d)) { $state = $domains[$d].domain_state; $dom = $d; break }
      }
    }
  }
  if (-not $state) { $state = 'n/a (no corporate domain)' }
  $verdict = switch ($state) {
    'site' { 'DROP - they already have a site' }
    'portal' { 'REVIEW - domain is a mail/ISP portal, site there is not the company s' }
    'parked' { 'KEEP - domain exists but no site (strong lead)' }
    'no_dns' { 'KEEP - domain does not resolve, no site (strong lead)' }
    'dead_http' { 'KEEP - domain resolves but is silent (strong lead)' }
    default { 'KEEP - unverified, re-check later' }
  }
  [void]$out.Add([pscustomobject]@{
    name = $l.name
    inn = $l.inn
    city = $l.city
    region = $l.region
    okved = $l.okved
    okved_code = $l.okved_code
    revenue = $l.revenue
    msp = $l.msp
    score = $l.score
    email_best = $l.email_best
    email_free = $l.email_free
    phone = $l.phone
    domain = $dom
    domain_state = $state
    domain_title = $(if ($dom -and $domains.ContainsKey($dom)) { $domains[$dom].title } else { '' })
    verdict = $verdict
    url = $l.url
  })
}

$out | Export-Csv -Path (Join-Path $root $OutFile) -NoTypeInformation -Encoding UTF8

Write-Host ''
$out | Group-Object domain_state | Sort-Object Count -Descending | ForEach-Object { Write-Host ("  {0,-28} {1}" -f $_.Name, $_.Count) }
$realSites = @($out | Where-Object { $_.domain_state -eq 'site' })
if ($realSites.Count -gt 0) {
  Write-Host ''
  Write-Host 'LEADS THAT TURN OUT TO HAVE A SITE (drop these):'
  $realSites | ForEach-Object { Write-Host ("  {0}  {1}  {2}" -f $_.name, $_.domain, $_.domain_title) }
}
$strong = @($out | Where-Object { $_.domain_state -in @('parked', 'no_dns', 'dead_http') })
$strong | ForEach-Object { ($_.email_best -split '\|')[0] } | Where-Object { $_ } | Sort-Object -Unique |
  Set-Content -Path (Join-Path $root 'noweb-emails-confirmed.txt') -Encoding UTF8
Write-Host ''
Write-Host ("strong leads (domain exists, no site): {0}" -f $strong.Count)
Write-Host "Files: $OutFile, noweb-emails-confirmed.txt"
