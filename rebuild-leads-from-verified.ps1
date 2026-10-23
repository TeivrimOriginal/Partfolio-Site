<#
  rebuild-leads-from-verified.ps1
  Восстанавливает noweb-leads.csv из noweb-leads-verified.csv.

  Зачем: 03.10.2026 filter-noweb.ps1 получил на вход уже отфильтрованный файл
  (без поля status), посчитал всё мёртвым и записал 0 строк поверх базы.
  Фильтр теперь защищён (test-filter-safety.ps1), но данные надо вернуть.

  noweb-leads-verified.csv содержит все поля, нужные для продажи, кроме
  address / regdate / capital / director / socials. Эти поля восстанавливаются
  пустыми - score переносится из verified как есть, чтобы не менять порядок.

  Run:
    powershell -ExecutionPolicy Bypass -File rebuild-leads-from-verified.ps1
#>
[CmdletBinding()]
param(
  [string]$Verified = 'noweb-leads-verified.csv',
  [string]$OutFile = 'noweb-leads.csv',
  [string]$BestFile = 'noweb-leads-best.csv',
  [string]$Segments = 'noweb-segments.csv'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$vPath = Join-Path $root $Verified
if (-not (Test-Path $vPath)) { throw "нет $Verified - восстанавливать нечего" }

$src = @(Import-Csv $vPath)
if ($src.Count -eq 0) { throw "$Verified пуст" }
Write-Host "восстанавливаю из $($src.Count) строк"

$out = New-Object System.Collections.ArrayList
foreach ($c in $src) {
  $why = @()
  if ($c.msp -match 'входит в реестр') { $why += 'МСП' }
  if ($c.phone) { $why += 'телефон' } else { $why += 'почта без телефона' }
  if ($c.revenue) { $why += ('выручка ' + $c.revenue) } else { $why += 'выручка н/д' }
  if ($c.domain_state) { $why += ('домен: ' + $c.domain_state) }

  $rev = 0.0
  if ($c.revenue) {
    $t = ($c.revenue -replace '\s', '')
    $mult = 1.0
    if ($t -match 'млрд') { $mult = 1000 } elseif ($t -match 'млн') { $mult = 1 } elseif ($t -match 'тыс') { $mult = 0.001 }
    $num = ($t -replace '[^\d,\.]', '')
    $d = 0.0
    if ([double]::TryParse(($num -replace ',', '.'), [ref]$d)) { $rev = [Math]::Round($d * $mult, 2) }
  }
  $section = ''
  if ($c.okved_code -match '^\s*(\d{1,2})') { $section = $Matches[1] }

  [void]$out.Add([pscustomobject]@{
    score = $c.score
    why = ($why -join ', ')
    name = $c.name
    opf = ''
    okved = $c.okved
    okved_code = $c.okved_code
    okved_section = $section
    city = $c.city
    region = $c.region
    address = ''
    msp = $c.msp
    revenue = $c.revenue
    revenue_mln = $rev
    regdate = ''
    capital = ''
    phone = $c.phone
    email_best = $c.email_best
    email_free = $c.email_free
    socials = ''
    director = ''
    inn = $c.inn
    ogrn = ''
    url = $c.url
  })
}

$leads = @($out | Sort-Object -Property @{ Expression = { [int]$_.score }; Descending = $true })
$leads | Export-Csv -Path (Join-Path $root $OutFile) -NoTypeInformation -Encoding UTF8
$best = @($leads | Where-Object { $_.email_best })
$best | Export-Csv -Path (Join-Path $root $BestFile) -NoTypeInformation -Encoding UTF8

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
@($seg | Sort-Object -Property @{ Expression = { $_.leads }; Descending = $true }) |
  Export-Csv -Path (Join-Path $root $Segments) -NoTypeInformation -Encoding UTF8

Write-Host ("восстановлено: {0} лидов, {1} с бизнес-почтой, {2} сегментов" -f $leads.Count, $best.Count, $seg.Count)
Write-Host "файлы: $OutFile, $BestFile, $Segments"
Write-Host 'пустые поля: opf, address, regdate, capital, director, socials - вернутся при первом полном сборе'
