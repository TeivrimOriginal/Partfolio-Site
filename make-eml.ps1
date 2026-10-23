<#
  make-eml.ps1 — собирает готовый к отправке .eml с примером сайта во вложении.

  Зачем .eml, а не просто текст: отправки с этой машины нет (ни SMTP-реквизитов,
  ни Outlook COM — проверено), а .eml открывается в любом почтовом клиенте
  двойным кликом и отправляется по F5. Тело и вложение уже собраны правильно,
  тема закодирована по RFC 2047 — ничего не потеряется.

  MIME-структура:
    multipart/mixed
      ├── multipart/alternative
      │     ├── text/plain; charset=utf-8      (письмо)
      │     └── text/html;  charset=utf-8      (то же письмо красиво)
      └── text/html; charset=utf-8; name=...  (ПРИМЕР САЙТА, вложение)

  Run:
    powershell -ExecutionPolicy Bypass -File make-eml.ps1 -All
    powershell -ExecutionPolicy Bypass -File make-eml.ps1 -Id d001
#>
[CmdletBinding()]
param(
  [string]$Id = '',
  [string]$DealsFile = 'deals.csv',
  [string]$From = 'teivrim21@gmail.com',
  [string]$FromName = 'Данила Аринов',
  [string]$Template = 'offer-500.txt',
  [string]$OutDir = 'outbox',
  [switch]$All,
  [switch]$NoAttach,
  [switch]$DryRun,
  [switch]$UseAlt
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$db = if ([IO.Path]::IsPathRooted($DealsFile)) { $DealsFile } else { Join-Path $root $DealsFile }
if (-not (Test-Path $db)) { throw "нет доски сделок: $db" }

$deals = @(Import-Csv $db)
if ($All) {
  # этап z1 = адрес отвергнут почтовым сервером. Такие письма собирать нельзя:
  # отправка в заведомо несуществующий ящик только портит статистику доставки
  # у отправителя и сжигает репутацию домена
  $todo = @($deals | Where-Object { $_.email -and $_.stage -ne 'z1' })
  $skipped = @($deals | Where-Object { $_.stage -eq 'z1' })
  foreach ($s in $skipped) { Write-Host ("  {0}: пропущен, адрес отвергнут сервером ({1})" -f $s.id, $s.email) -ForegroundColor DarkYellow }
}
else {
  $todo = @($deals | Where-Object { $_.id -eq $Id })
  if ($todo.Count -eq 0) { throw "нет сделки $Id" }
}
if ($todo.Count -eq 0) { Write-Host 'нет сделок с почтой'; exit 0 }

function Enc-Word([string]$s) {
  # RFC 2047: тема и имя отправителя с не-ASCII кодируются base64
  return '=?utf-8?B?' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) + '?='
}
function To-Base64Lines([string]$s) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s))
  $sb = New-Object Text.StringBuilder
  for ($i = 0; $i -lt $b64.Length; $i += 76) {
    $len = [Math]::Min(76, $b64.Length - $i)
    [void]$sb.AppendLine($b64.Substring($i, $len))
  }
  return $sb.ToString().TrimEnd()
}
function Html-Of-Part($tplPath, [string]$company) {
  # простой перевод письма в HTML для второй альтернативной части
  $t = [IO.File]::ReadAllText($tplPath, [Text.Encoding]::UTF8)
  $body = (($t -split "`r?`n") | Where-Object { -not $_.Trim().StartsWith('#') -and -not $_.Trim().StartsWith('ТЕМА:') }) -join "`n"
  $esc = $body -replace '&', '&amp;' -replace '<', '&lt;' -replace '>', '&gt;'
  $esc = $esc -replace '(?m)^(.+)$', '<p style="margin:0 0 12px">$1</p>'
  return ('<!doctype html><html><body style="font:15px/1.6 Arial,sans-serif;color:#111;max-width:640px">' +
    '<div style="font:700 13px Arial;color:#b45309;background:#fff7ed;border:1px solid #fed7aa;padding:8px 12px;border-radius:8px;margin-bottom:16px">письмо отправлено вручную, отвечать можно прямо на него</div>' +
    $esc + '</body></html>')
}

$tplPath = Join-Path $root $Template
if (-not (Test-Path $tplPath)) { throw "нет шаблона: $tplPath" }

$outDirPath = Join-Path $root $OutDir
if (-not (Test-Path $outDirPath)) { New-Item -ItemType Directory -Path $outDirPath -Force | Out-Null }

$CRLF = "`r`n"
$made = @()
foreach ($d in $todo) {
  if (-not $d.email) { Write-Host ("  {0}: нет почты, пропуск" -f $d.id) -ForegroundColor Yellow; continue }

  # отказ доставки не оставляет сделку без адреса: в базе у той же фирмы почти
  # всегда есть запасной адрес на фримейле, и он почти наверняка существует
  $mail = $d.email
  $alt = ''
  if (Test-Path (Join-Path $root 'noweb-leads-verified.csv')) {
    $src = @(Import-Csv (Join-Path $root 'noweb-leads-verified.csv') | Where-Object { $_.inn -and $_.inn -eq $d.inn })
    if ($src.Count -gt 0) {
      foreach ($cand in (([string]$src[0].email_best + '|' + [string]$src[0].email_free) -split '\|')) {
        $cand = $cand.Trim()
        if ($cand -and $cand -ne $mail -and $cand -match '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$') { $alt = $cand; break }
      }
    }
  }
  if (($d.stage -eq 'z1' -or $d.sent_date) -and $alt -and $UseAlt) {
    Write-Host ("  {0}: адрес {1} отвергнут, подставляю запасной {2}" -f $d.id, $mail, $alt) -ForegroundColor Yellow
    $mail = $alt
  }

  $raw = [IO.File]::ReadAllText($tplPath, [Text.Encoding]::UTF8)
  $subject = 'Сайт для предприятия'
  $m = [regex]::Match($raw, '(?m)^ТЕМА:\s*(.+)$')
  if ($m.Success) { $subject = $m.Groups[1].Value.Trim() }
  $lines = @()
  foreach ($ln in ($raw -split "`r?`n")) {
    $t = $ln.Trim()
    if ($t.StartsWith('#')) { continue }
    if ($t.StartsWith('ТЕМА:')) { continue }
    $lines += $ln
  }
  $text = ($lines -join "`r`n").Trim()

  $subj = $subject -replace '\{name\}', $d.company
  $subj = $subj -replace '\{city\}', $d.city
  $subj = $subj -replace '\{okved\}', $d.okved

  $text = $text -replace '\{name\}', $d.company
  $text = $text -replace '\{city\}', $(if ($d.city) { $d.city } else { 'вашем городе' })
  $text = $text -replace '\{okved\}', $(if ($d.okved) { $d.okved.ToLower() } else { 'вашей деятельностью' })
  $text = $text -replace '\{phone\}', $(if ($d.phone) { $d.phone } else { 'не указан в реестре' })
  $text = $text -replace '\{email\}', $mail
  $text = $text -replace '\{reply\}', $From
  # имена вложений — по id сделки. Раньше тут стояло жёсткое 'd001-example.html',
  # и все шесть писем называли файл, которого у получателя нет во вложении.
  $text = $text -replace '\{sample\}', ("{0}-example.html" -f $d.id)
  $text = $text -replace '\{sampleadmin\}', ("{0}-admin-example.html" -f $d.id)

  $html = Html-Of-Part $tplPath $d.company
  # PS 5.1: $html -replace 'pat', 'x' + $y  парсится как $html -replace ('pat','x') + $y
  # (запятая собирает массив) и падает с BadReplaceArgument. Скобки обязательны.
  $html = $html -replace '&amp;\{name\}', ('&amp;' + $d.company)
  $html = $html -replace '\{name\}', $d.company -replace '\{city\}', $d.city -replace '\{okved\}', $d.okved
  $html = $html -replace '\{phone\}', $d.phone -replace '\{email\}', $mail -replace '\{reply\}', $From

  $attachPath = Join-Path $outDirPath ("sample\{0}-example.html" -f $d.id)
  $adminPath = Join-Path $outDirPath ("sample\{0}-admin-example.html" -f $d.id)
  $hasAttach = (-not $NoAttach) -and (Test-Path $attachPath)
  if ((-not $NoAttach) -and -not $hasAttach) { Write-Host ("  {0}: нет примера {1}, сначала make-sample.ps1 -Id {0}" -f $d.id, $attachPath) -ForegroundColor Yellow }
  $hasAdmin = $hasAttach -and (Test-Path $adminPath)

  $boundaryAlt = 'alt-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
  $boundaryMix = 'mix-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
  $now = (Get-Date).ToUniversalTime().ToString('ddd, dd MMM yyyy HH:mm:ss +0000', [Globalization.CultureInfo]::InvariantCulture)

  $sb = New-Object Text.StringBuilder
  function Add([string]$x) { [void]$script:sb.AppendLine($x) }

  Add ('From: ' + (Enc-Word $FromName) + ' <' + $From + '>')
  Add ('To: ' + $mail)
  Add ('Subject: ' + (Enc-Word $subj))
  Add ('Date: ' + $now)
  Add ('Message-ID: <' + [Guid]::NewGuid().ToString('N') + '@localhost>')
  Add 'MIME-Version: 1.0'
  if ($hasAttach) {
    Add ('Content-Type: multipart/mixed; boundary="' + $boundaryMix + '"')
    Add ''
    Add ('--' + $boundaryMix)
    Add ('Content-Type: multipart/alternative; boundary="' + $boundaryAlt + '"')
    Add ''
    Add ('--' + $boundaryAlt)
    Add 'Content-Type: text/plain; charset=utf-8'
    Add 'Content-Transfer-Encoding: base64'
    Add ''
    Add (To-Base64Lines $text)
    Add ''
    Add ('--' + $boundaryAlt)
    Add 'Content-Type: text/html; charset=utf-8'
    Add 'Content-Transfer-Encoding: base64'
    Add ''
    Add (To-Base64Lines $html)
    Add ''
    Add ('--' + $boundaryAlt + '--')
    Add ''
    Add ('--' + $boundaryMix)
    $attName = ("{0}-example.html" -f $d.id)
    Add ('Content-Type: text/html; charset=utf-8; name="' + $attName + '"')
    Add 'Content-Transfer-Encoding: base64'
    Add ('Content-Disposition: attachment; filename="' + $attName + '"')
    Add ''
    Add (To-Base64Lines ([IO.File]::ReadAllText($attachPath, [Text.Encoding]::UTF8)))
    Add ''
    if ($hasAdmin) {
      $admName = ("{0}-admin-example.html" -f $d.id)
      Add ('--' + $boundaryMix)
      Add ('Content-Type: text/html; charset=utf-8; name="' + $admName + '"')
      Add 'Content-Transfer-Encoding: base64'
      Add ('Content-Disposition: attachment; filename="' + $admName + '"')
      Add ''
      Add (To-Base64Lines ([IO.File]::ReadAllText($adminPath, [Text.Encoding]::UTF8)))
      Add ''
    }
    Add ('--' + $boundaryMix + '--')
  } else {
    Add 'Content-Type: text/plain; charset=utf-8'
    Add 'Content-Transfer-Encoding: base64'
    Add ''
    Add (To-Base64Lines $text)
  }

  $eml = $sb.ToString() -replace "(?<!`r)`n", $CRLF
  $file = '{0}.eml' -f $d.id
  $path = Join-Path $outDirPath $file
  if (-not $DryRun) { [IO.File]::WriteAllText($path, $eml, (New-Object Text.UTF8Encoding $false)) }
  $made += [pscustomobject]@{ id = $d.id; to = $mail; company = $d.company; subject = $subj; eml = $file; attach = $(if ($hasAttach) { $attName } else { '' }); attach2 = $(if ($hasAdmin) { ("{0}-admin-example.html" -f $d.id) } else { '' }); bytes = $(if ($DryRun) { 0 } else { (Get-Item $path).Length }) }
  Write-Host ("  {0}  {1,-26} {2,6} байт  вложение: {3}" -f $d.id, $mail, $made[-1].bytes, $(if ($hasAttach) { $attName } else { 'НЕТ' }))
}

if (-not $DryRun -and $made.Count -gt 0) {
  $made | Export-Csv -Path (Join-Path $outDirPath 'eml-index.csv') -NoTypeInformation -Encoding UTF8
  Write-Host ''
  Write-Host ("готово писем: {0}. Открой .eml в почтовом клиенте и нажми отправить." -f $made.Count)
  Write-Host "Не отправляй всё разом: 2-3 письма в день, по одному получателю."
} elseif ($DryRun) { Write-Host 'DryRun: файлы не записаны' }
