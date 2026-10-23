<#
  send-wave.ps1 — генерирует письма ровно для тех сделок, которым это нужно сейчас.

  Смысл: руками выбирать шаблон под этап — это как раз то место, где продавец
  ошибается (шлёт второе касание человеку, которому ещё не отвечали на первое).
  Здесь выбор шаблона определяется этапом сделки, а этап двигается автоматически:

    a1 -> offer-500.txt        -> a2   (первое касание, цены 500/1000/2000)
    a2 -> followup-1-500.txt   -> a3   (день 4)
    a3 -> followup-2-500.txt   -> a4   (день 11)
    a4 -> breakup.txt          -> a5   (день 18, адрес удаляется)

  Для первого касания письмо собирает make-eml.ps1: он кладёт вложение с
  примером сайта (outbox\sample\dNNN-example.html) и кодирует тему по RFC 2047.
  run-offer.cmd делает всю цепочку: пример -> .eml -> проверка.

  Письма только ЧИТАЮТСЯ, ничего не отправляется: отправка ручная, из почтового
  клиента. Скрипт готовит файлы + порядок отправки.

  Run:
    powershell -ExecutionPolicy Bypass -File send-wave.ps1 -Limit 7
    powershell -ExecutionPolicy Bypass -File send-wave.ps1 -Limit 7 -DryRun
#>
[CmdletBinding()]
param(
  [string]$DealsFile = 'deals.csv',
  [int]$Limit = 7,
  [string]$From = 'teivrim@gmail.com',
  [string]$OutDir = 'outbox',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$db = if ([IO.Path]::IsPathRooted($DealsFile)) { $DealsFile } else { Join-Path $root $DealsFile }
if (-not (Test-Path $db)) { throw "нет доски сделок: $db" }

$tpl = @{
  'a1' = 'offer-500.txt'
  'a2' = 'followup-1-500.txt'
  'a3' = 'followup-2-500.txt'
  'a4' = 'breakup.txt'
}
$nextStage = @{ 'a1' = 'a2'; 'a2' = 'a3'; 'a3' = 'a4'; 'a4' = 'a5' }

function City-Of([string]$addr) {
  if (-not $addr) { return 'вашем городе' }
  $parts = @($addr -split ',\s*')
  $c = ''
  foreach ($p in $parts) {
    $p = $p.Trim()
    if ($p -match '^(г\.|г |город|с\.|пос\.|пгт\.|сгт\.|поселок|село|деревня)') { $c = $p; break }
  }
  if (-not $c -and $parts.Count -ge 2) { $c = $parts[1].Trim() }
  if (-not $c) { return 'вашем городе' }
  $c = $c -replace '^\s*(г\.\s*о\.|го\s|г\.о\.|мкр\.?)\s*', ''
  if ($c -match '^(г\.|город|с\.)\s+(.+)$') { $c = $Matches[2] }
  if ($c -match '^(поселок|село|деревня|пгт|сгт)\s+(.+)$') { $c = $Matches[2] }
  return ($c -replace '\s+', ' ')
}

$deals = @(Import-Csv $db)
if ($deals.Count -eq 0) { Write-Host 'сделок нет'; exit 0 }
$today = Get-Date -Format 'yyyy-MM-dd'

$todo = @($deals | Where-Object {
    $tpl.ContainsKey($_.stage) -and $_.next_action_date -and $_.next_action_date -le $today
  } | Sort-Object -Property @{ Expression = { [int]$_.score }; Descending = $true })
if ($Limit -gt 0 -and $todo.Count -gt $Limit) { $todo = @($todo[0..($Limit - 1)]) }

Write-Host ("готово к отправке: {0} (лимит {1})" -f $todo.Count, $Limit)
if ($todo.Count -eq 0) {
  Write-Host "сейчас задач нет. Следующие даты:"
  foreach ($d in ($deals | Where-Object { $_.next_action_date -and $_.stage -in @('a1', 'a2', 'a3', 'a4') } | Sort-Object next_action_date | Select-Object -First 5)) {
    Write-Host ("  {0}  {1}  {2}  ({3} -> {4})" -f $d.next_action_date, $d.id, $d.company, $d.stage, $nextStage[$d.stage])
  }
  exit 0
}

$outDirPath = Join-Path $root $OutDir
if (-not (Test-Path $outDirPath)) { New-Item -ItemType Directory -Path $outDirPath | Out-Null }

$order = @()
foreach ($d in $todo) {
  $tplFile = Join-Path $root $tpl[$d.stage]
  if (-not (Test-Path $tplFile)) { Write-Host ("  пропуск {0}: нет шаблона {1}" -f $d.id, $tpl[$d.stage]); continue }
  $raw = [IO.File]::ReadAllText($tplFile, [Text.Encoding]::UTF8)

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

  $nm = $d.company
  $city = if ($d.city) { $d.city } else { City-Of '' }
  $okved = if ($d.okved) { $d.okved.ToLower() } else { 'вашей деятельностью' }
  $phone = if ($d.phone) { $d.phone } else { 'не указан в реестре' }
  $mail = $d.email

  $txt = $body
  $txt = $txt -replace '\{name\}', $nm
  $txt = $txt -replace '\{city\}', $city
  $txt = $txt -replace '\{okved\}', $okved
  $txt = $txt -replace '\{phone\}', $phone
  $txt = $txt -replace '\{email\}', $mail
  $txt = $txt -replace '\{reply\}', $From
  $subj = $subject -replace '\{name\}', $nm -replace '\{city\}', $city -replace '\{okved\}', $okved

  if (-not $mail) {
    Write-Host ("  {0} {1}: нет почты — этап пропущен, работать по телефону" -f $d.id, $nm) -ForegroundColor Yellow
    continue
  }

  $slug = ($nm -replace '[^\wа-яА-ЯёЁ\- ]', '' -replace '\s+', '_')
  if ($slug.Length -gt 36) { $slug = $slug.Substring(0, 36) }
  $file = '{0}-{1}-{2}.txt' -f $d.id, $d.stage, $slug
  if (-not $DryRun) {
    [IO.File]::WriteAllText((Join-Path $outDirPath $file), ("ТЕМА: " + $subj + "`r`n`r`n" + $txt), (New-Object Text.UTF8Encoding $true))
  }
  $order += [pscustomobject]@{
    id = $d.id; was_stage = $d.stage; becomes = $nextStage[$d.stage]; to = $mail; company = $nm
    file = $file; score = $d.score; send_by = $(if ($d.stage -eq 'a1') { 'сегодня, первое касание' } else { 'сегодня, быть готовым к отказу' })
  }
  Write-Host ("  {0}  {1} -> {2}  {3}  ({4})" -f $d.id, $d.stage, $nextStage[$d.stage], $nm, $mail)
}

if ($DryRun) {
  Write-Host ''
  Write-Host 'DryRun: файлы не записаны, этапы не сдвинуты.'
  exit 0
}

if ($order.Count -gt 0) {
  $order | Export-Csv -Path (Join-Path $outDirPath 'wave.csv') -NoTypeInformation -Encoding UTF8
  # двигаем этапы
  for ($i = 0; $i -lt $order.Count; $i++) {
    $o = $order[$i]
    $idx = -1
    for ($j = 0; $j -lt $deals.Count; $j++) { if ($deals[$j].id -eq $o.id) { $idx = $j } }
    if ($idx -lt 0) { continue }
    $deals[$idx].stage = $o.becomes
    $deals[$idx].stage_entered = $today
    if ($o.becomes -eq 'a2') {
      $deals[$idx].sent_date = $today
      $deals[$idx].next_action_date = (Get-Date).AddDays(4).ToString('yyyy-MM-dd')
      $deals[$idx].next_action = 'follow-up 1'
    } elseif ($o.becomes -eq 'a3') {
      $deals[$idx].next_action_date = (Get-Date).AddDays(7).ToString('yyyy-MM-dd')
      $deals[$idx].next_action = 'follow-up 2'
    } elseif ($o.becomes -eq 'a4') {
      $deals[$idx].next_action_date = (Get-Date).AddDays(7).ToString('yyyy-MM-dd')
      $deals[$idx].next_action = 'break-up / закрыть в ноль'
    } else {
      $deals[$idx].next_action_date = ''
      $deals[$idx].next_action = ''
      $deals[$idx].notes = (($deals[$idx].notes, 'тишина после 3 касаний, адрес удалить') | Where-Object { $_ }) -join '; '
    }
  }
  $deals | Export-Csv -Path $db -NoTypeInformation -Encoding UTF8
  Write-Host ''
  Write-Host ("подготовлено {0} писем в {1}\, этапы сдвинуты, порядок: {1}\wave.csv" -f $order.Count, $OutDir)
  Write-Host 'отправляй руками, по одному получателю, без копий и вложений.'
} else {
  Write-Host 'писем не создано.'
}
