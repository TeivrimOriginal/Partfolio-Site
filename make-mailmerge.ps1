<#
  make-mailmerge.ps1
  Turns noweb-leads.csv into one personalized letter per company.

  Why one file per letter: NOTES.md records the two things that got the previous
  batch marked as spam - every recipient could see the other addresses in the To:
  header, and every letter was byte-identical. So: single recipient, company name
  and activity substituted, letters numbered, and a send order that keeps at most
  a few letters per company per wave.

  Run:
    powershell -ExecutionPolicy Bypass -File make-mailmerge.ps1 -Count 25
#>
[CmdletBinding()]
param(
  [string]$LeadsFile = 'noweb-leads.csv',
  [string]$Template = 'site-offer-template.txt',
  [int]$Count = 25,
  [string]$OutDir = 'outbox',
  [string]$From = 'teivrim@gmail.com',
  [switch]$FreeMailOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$leadsPath = Join-Path $root $LeadsFile
$tplPath = Join-Path $root $Template
if (-not (Test-Path $leadsPath)) { throw "no leads file: $leadsPath" }
if (-not (Test-Path $tplPath)) { throw "no template: $tplPath" }

$raw = [IO.File]::ReadAllText($tplPath, [Text.Encoding]::UTF8)
# keep the ТЕМА: line out of the letter body, drop the author's own # comments
$subject = 'Сайт для предприятия'
$m = [regex]::Match($raw, '(?m)^ТЕМА:\s*(.+)$')
if ($m.Success) { $subject = $m.Groups[1].Value.Trim() }
$bodyLines = @()
foreach ($ln in ($raw -split "`r?`n")) {
  $t = $ln.Trim()
  if ($t.StartsWith('#')) { continue }
  if ($t.StartsWith('ТЕМА:')) { continue }
  $bodyLines += $ln
}
$body = ($bodyLines -join "`r`n").Trim()

$leads = @(Import-Csv $leadsPath)
Write-Host "leads in file: $($leads.Count)"

function City-Of([string]$addr) {
  if (-not $addr) { return 'вашем городе' }
  $parts = @($addr -split ',\s*')
  for ($i = 0; $i -lt $parts.Count; $i++) {
    $p = $parts[$i].Trim()
    if ($p -match '^(г\.|г |город|с\.|пос\.|пгт\.|сгт\.|поселок|село|деревня)') {
      $c = $p; break
    }
  }
  if (-not $c) {
    for ($i = 0; $i -lt $parts.Count; $i++) {
      $p = $parts[$i].Trim()
      if ($p -match '(область|край|республика)') { $c = $p; break }
    }
  }
  if (-not $c -and $parts.Count -ge 2) { $c = $parts[1].Trim() }
  if (-not $c) { return 'вашем городе' }
  $c = $c -replace '^\s*(г\.\s*о\.|го\s|г\.о\.|мкр\.?|м\s?н\s?о)\s*', ''
  if ($c -match '^(г\.|город|с\.)\s+(.+)$') { $c = $Matches[2] }
  if ($c -match '^(поселок|село|деревня|пгт|сгт)\s+(.+)$') { $c = $Matches[2] }
  return ($c -replace '\s+', ' ')
}

$outDirPath = Join-Path $root $OutDir
if (-not (Test-Path $outDirPath)) { New-Item -ItemType Directory -Path $outDirPath | Out-Null }

$used = @{}
$order = @()
$n = 0
$idx = 0
foreach ($l in $leads) {
  if ($n -ge $Count) { break }
  $idx++
  $mails = @()
  if ($l.email_best) { $mails += ($l.email_best -split '\|') }
  if ($FreeMailOnly -and $l.email_free) { $mails = @() }
  if (-not $FreeMailOnly -and $l.email_free) { $mails += ($l.email_free -split '\|') }
  $mails = @($mails | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -match '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$' } | Sort-Object -Unique)
  if ($mails.Count -eq 0) { continue }
  $to = $mails[0]
  $key = if ($l.inn) { $l.inn } else { $l.name }
  if ($used.ContainsKey($key)) { continue }

  # filter-noweb.ps1 already resolved a clean city name; only fall back when absent
  $city = ''
  if ($l.city) { $city = $l.city.Trim() }
  if (-not $city) { $city = City-Of $l.address }
  $okved = if ($l.okved) { $l.okved.ToLower() } else { 'вашей деятельностью' }
  $phone = if ($l.phone) { ($l.phone -split '\|')[0].Trim() } else { '—' }
  $nm = ($l.name -replace '&quot;', '"')

  $txt = $body
  $txt = $txt -replace '\{name\}', $nm
  $txt = $txt -replace '\{city\}', $city
  $txt = $txt -replace '\{okved\}', $okved
  $txt = $txt -replace '\{phone\}', $phone
  $txt = $txt -replace '\{email\}', $to
  $txt = $txt -replace '\{reply\}', $From

  $subj = $subject -replace '\{name\}', $nm -replace '\{city\}', $city -replace '\{okved\}', $okved

  $slug = ($nm -replace '[^\wа-яА-ЯёЁ\- ]', '' -replace '\s+', '_')
  if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40) }
  $file = '{0:d3}-{1}.txt' -f ($idx), $slug
  [IO.File]::WriteAllText((Join-Path $outDirPath $file), ("ТЕМА: " + $subj + "`r`n`r`n" + $txt), (New-Object Text.UTF8Encoding $true))
  $order += [pscustomobject]@{
    n = $n + 1; file = $file; to = $to; company = $nm; inn = $l.inn
    city = $city; okved = $okved; score = $l.score; revenue = $l.revenue
    email_kind = if ($l.email_best) { 'business' } else { 'freemail' }
  }
  $used[$key] = $true
  $n++
}

$order | Export-Csv -Path (Join-Path $outDirPath 'index.csv') -NoTypeInformation -Encoding UTF8
Write-Host "letters written: $($order.Count) -> $OutDir\"
$order | Group-Object email_kind | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Name, $_.Count) }
Write-Host 'Send rules: 1 recipient per mail, 5-10 letters per hour, never two waves on the same day.'
Write-Host "Order file: $OutDir\index.csv"
