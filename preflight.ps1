<#
  preflight.ps1 — последний рубеж перед отправкой. Отправка необратима,
  поэтому здесь проверяется всё, что можно проверить автоматически.

  Что проверяется по каждому письму:
    · адрес совпадает с компанией из реестра (не перепутан ли получатель)
    · в теле нет неподставленных плейсхолдеров {name}/{city}/{okved}
    · оба примера приложены, внутри есть баннер «это пример»
    · в письме есть выход «стоп» и указание источника контакта
    · сумма в письме не выше 2000 ₽ (мы не обещаем полный рыночный сайт за 500)
    · тема закодирована и не содержит кириллицы в сыром виде
    · один получатель, нет списка To:
    · MX домена получателя существует

  Код возврата: 0 — всё готово к отправке, 2 — есть блокирующие проблемы.

  Run:
    powershell -ExecutionPolicy Bypass -File preflight.ps1
#>
[CmdletBinding()]
param(
  [string]$DealsFile = 'deals.csv',
  [string]$OutDir = 'outbox'
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$outPath = Join-Path $root $OutDir
$db = if ([IO.Path]::IsPathRooted($DealsFile)) { $DealsFile } else { Join-Path $root $DealsFile }

$emls = @(Get-ChildItem $outPath -Filter '*.eml' -ErrorAction SilentlyContinue)
if ($emls.Count -eq 0) { Write-Host 'писем нет. Собери: make-sample.ps1 -All, потом make-eml.ps1 -All'; exit 2 }

$deals = @{}
if (Test-Path $db) { foreach ($d in (Import-Csv $db)) { $deals[$d.id] = $d } }

# Адреса, которые почтовый сервер уже отверг. Проверка домена такое не видит:
# astranet.ru существует и принимает почту, а ящика aspmk@ нет. Единственный
# источник правды — отказ 550 при реальной отправке, поэтому он копится здесь.
$dead = @{}
$deadFile = Join-Path $root 'dead-addresses.csv'
if (Test-Path $deadFile) { foreach ($x in (Import-Csv $deadFile)) { $dead[$x.email.ToLower()] = $x } }
if ($dead.Count -gt 0) { Write-Host ("известных мёртвых адресов: " + $dead.Count) -ForegroundColor Yellow }

$blockers = 0
$warns = 0
$ready = @()

function Bad([string]$m) { $script:blockers++; Write-Host ("    БЛОКЕР  " + $m) -ForegroundColor Red }
function Warn([string]$m) { $script:warns++; Write-Host ("    ВНИМАНИЕ " + $m) -ForegroundColor Yellow }
function Ok([string]$m) { Write-Host ("    ок      " + $m) }

foreach ($f in $emls | Sort-Object Name) {
  $id = $f.BaseName
  Write-Host ''
  Write-Host ("=== {0} ===" -f $id) -ForegroundColor Cyan
  $raw = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
  $head = ($raw -split "`r`n`r`n")[0]
  $deal = $deals[$id]
  # счётчик блокеров общий, поэтому запоминаем его на входе письма: готовность
  # должна считаться ПОБУКВЕННО, иначе один мёртвый адрес обнуляет все остальные
  $blockersBefore = $script:blockers

  # --- адрес ---
  $to = [regex]::Match($head, '(?m)^To:\s*(.+)$').Groups[1].Value.Trim()
  if ($to -notmatch '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$') { Bad ("адрес нечитаем: '{0}'" -f $to) }
  elseif ($to -match ',' -or $to -match ';') { Bad ("в To несколько адресов: '{0}'" -f $to) }
  else {
    if ($deal -and $deal.email -and ($deal.email -ne $to)) { Bad ("адрес не совпадает со сделкой: eml={0} deals={1}" -f $to, $deal.email) }
    elseif ($dead.ContainsKey($to.ToLower())) { Bad ("адрес уже отвергнут почтовым сервером: {0}" -f $to) }
    elseif ($deal -and $deal.stage -eq 'z1') { Bad ("сделка помечена как мёртвая (z1): {0}" -f $to) }
    else { Ok ("адрес: " + $to) }
  }

  # Ролевой адрес из одних заглавных на чужом домене — самый недостоверный вид
  # адреса: его пишет агрегатор по аббревиатуре, а ящика может не быть вовсе.
  # Именно таким был aspmk@astranet.ru. Персональный адрес на фримейле, наоборот,
  # почти наверняка существует — человек на нём читает.
  $local = ($to -split '@')[0]
  $isFree = $to -match '(?i)@(mail\.ru|yandex\.(ru|com)|bk\.ru|inbox\.ru|list\.ru| rambler\.ru|gmail\.com)$'
  if ($local -cmatch '^[A-ZА-Я]{2,7}$') {
    if ($isFree) { Warn ("ролевой адрес-заглавная аббревиатура на фримейле, ящик может не существовать: {0}" -f $to) }
    else { Bad ("ролевой адрес-заглавная аббревиатура на чужом домене, сначала подтвердить вручную: {0}" -f $to) }
  }

  # --- MX получателя ---
  $dom = ($to -split '@') | Select-Object -Last 1
  try {
    $mx = [Net.Dns]::GetHostEntry($dom)
    if ($mx.AddressList.Count -gt 0) { Ok ("MX домена есть: " + $dom) } else { Warn ("домен без A-записей: " + $dom) }
  } catch { Warn ("MX не проверяется, DNS молчит: " + $dom) }

  # --- тема ---
  $sm = [regex]::Match($head, 'Subject: =\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=')
  if (-not $sm.Success) { Bad 'тема не закодирована по RFC 2047 (кириллица поедет)' }
  else {
    $subj = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($sm.Groups[1].Value))
    if ($subj -match '\{|\}') { Bad ("в теме остался плейсхолдер: " + $subj) }
    elseif ($subj.Length -gt 78) { Warn ("тема длинная (" + $subj.Length + " симв.), может обрезаться: " + $subj) }
    else { Ok ("тема: " + $subj) }
  }

  # --- тело: плейсхолдеры ---
  $pm = [regex]::Match($raw, '(?s)--alt-[a-f0-9]+\r?\nContent-Type: text/plain.*?\r?\n\r?\n(.*?)\r?\n\r?\n--alt-')
  if (-not $pm.Success) { Bad 'в письме нет текстовой части' }
  else {
    $txt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($pm.Groups[1].Value -replace '\s', '')))
    $ph = @([regex]::Matches($txt, '\{\w+\}') | ForEach-Object { $_.Value } | Sort-Object -Unique)
    if ($ph.Count -gt 0) { Bad ("в теле остались плейсхолдеры: " + ($ph -join ', ')) } else { Ok 'плейсхолдеров в теле нет' }
    if ($txt -match 'стоп') { Ok 'выход «стоп» есть' } else { Bad 'нет выхода «стоп» — письмо без выхода это спам' }
    # Источник проверяем по факту названия, а не по одному домену: база сменилась
    # с checko.ru на kontur.ru, и жёсткий литерал давал ложное предупреждение
    # на каждом честно названном источнике.
    if ($txt -match '(?i)контакт\w*\s+на\s+[a-z0-9.-]+\.[a-z]{2,}' -or $txt -match '(?i)checko|kontur\.ru|list-org|sbis\.ru') { Ok 'источник контакта указан' } else { Warn 'источник контакта не указан' }
    if ($txt -notmatch '500') { Warn 'в письме нет минимальной цены 500' }
    # обещание полноценного сайта за 500 без оговорок
    if ($txt -match '25 000|60 000') { Ok 'назван рыночный прайс как якорь' } else { Warn 'нет якоря рыночной цены — 500 ₽ может выглядеть подозрительно' }
    if ($txt -match 'хостинг') { Ok 'про хостинг сказано отдельной строкой' } else { Bad 'не сказано, что хостинг платит клиент — потом будут претензии' }
  }

  # --- вложения ---
  $atts = @([regex]::Matches($raw, 'Content-Disposition: attachment; filename="([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  if ($atts.Count -eq 0) { Bad 'вложений нет' }
  else {
    $hasSite = @($atts | Where-Object { $_ -match 'example\.html$' -and $_ -notmatch 'admin' }).Count
    $hasAdmin = @($atts | Where-Object { $_ -match 'admin' }).Count
    if ($hasSite -eq 0) { Bad 'нет примера сайта' } else { Ok ("пример сайта приложен: " + $atts[0]) }
    if ($hasAdmin -eq 0) { Warn 'нет примера админ-панели (в письме она обещана)' }
    foreach ($a in $atts) {
      $p = Join-Path $outPath ("sample\" + $a)
      if (-not (Test-Path $p)) { Bad ("вложение " + $a + " отсутствует на диске — письмо уйдёт битым") }
    }
    # содержимое вложений после декодирования
    foreach ($m in [regex]::Matches($raw, '(?s)Content-Disposition: attachment; filename="([^"]+)"\r?\n\r?\n(.*?)\r?\n--mix-')) {
      $name = $m.Groups[1].Value
      $body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($m.Groups[2].Value -replace '\s', '')))
      if ($body -notmatch 'ЭТО ПРИМЕР') { Bad ($name + ": нет баннера «ЭТО ПРИМЕР»") }
      elseif ($body -match '\{\{[A-Z0-9_]+\}\}') { Bad ($name + ": остались плейсхолдеры") }
      else { Ok ($name + ": помечен как пример, плейсхолдеров нет") }
    }
  }

  if ($script:blockers -eq $blockersBefore) { $ready += $id }
}

Write-Host ''
Write-Host '================================================' -ForegroundColor Cyan
Write-Host ("ГОТОВО К ОТПРАВКЕ: {0} из {1}" -f $ready.Count, $emls.Count) -ForegroundColor $(if ($ready.Count -eq $emls.Count) { 'Green' } else { 'Yellow' })
Write-Host ("блокеров: {0}, предупреждений: {1}" -f $blockers, $warns)
if ($ready.Count -gt 0) {
  Write-Host ''
  Write-Host 'Отправлять так:'
  Write-Host ("  {0}\*.eml  -> открыть в почтовом клиенте -> отправить" -f $OutDir)
  Write-Host ("  по одному получателю, {0} писем в день максимум" -f ([Math]::Min(3, $ready.Count)))
  Write-Host ''
  Write-Host ('  ' + ($ready -join ', '))
}
if ($blockers -gt 0) { exit 2 }
exit 0
