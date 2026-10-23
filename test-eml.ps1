<#
  test-eml.ps1 - проверяет, что .eml собран правильно. Без этого «просто отправь»
  превращается в письмо с битым вложением или с темой из вопросительных знаков.
  Проверяем: заголовки, кодировку темы, части MIME, и что вложение после
  декодирования байт-в-байт равно исходному примеру сайта.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$out = Join-Path $root 'outbox'
$pass = 0; $fail = 0
function Check { param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else { $script:fail++; Write-Host "  FAIL  $N  $D" }
}

$emls = @(Get-ChildItem $out -Filter '*.eml' -ErrorAction SilentlyContinue)
Write-Host "проверяю $($emls.Count) файлов .eml"
Check 'есть хотя бы один .eml' ($emls.Count -gt 0)

foreach ($f in $emls) {
  $id = $f.BaseName
  $raw = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
  $head = ($raw -split "`r`n`r`n")[0]

  Check "${id}: есть From" ($head -match '(?m)^From: ')
  # адрес отправителя обязан совпадать с тем, куда реально приходят ответы.
  # Раньше дефолт в make-eml.ps1 был teivrim@gmail.com, а ящик — teivrim21@:
  # письма уходили с чужого адреса, и подпись вводила в заблуждение.
  Check "${id}: From = teivrim21@gmail.com" ($head -match 'teivrim21@gmail\.com') $head
  Check "${id}: есть To" ($head -match '(?m)^To: .+@.+\..+')
  Check "${id}: тема закодирована по RFC 2047" ($head -match 'Subject: =\?utf-8\?B\?[A-Za-z0-9+/=]+\?=')
  Check "${id}: MIME-Version" ($head -match 'MIME-Version: 1\.0')
  Check "${id}: multipart/mixed" ($head -match 'multipart/mixed')
  Check "${id}: есть text/plain" ($raw -match 'Content-Type: text/plain')
  Check "${id}: есть text/html (тело)" ($raw -match 'Content-Type: text/html; charset=utf-8\r?\nContent-Transfer-Encoding: base64')

  # декодировать тему
  $sm = [regex]::Match($head, 'Subject: =\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=')
  if ($sm.Success) {
    $subj = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($sm.Groups[1].Value))
    Check "${id}: тема читается по-русски" ($subj -match '[\u0400-\u04FF]') $subj
    Check "${id}: в теме нет Company-заглушки" ($subj -notmatch '\{|\}') $subj
  } else { Check "${id}: тема декодируется" $false }

  # вложение: последняя base64-секция после Content-Disposition: attachment
  $am = [regex]::Match($raw, '(?s)Content-Disposition: attachment; filename="([^"]+)"\r?\n\r?\n(.*?)\r?\n--mix-.*?--')
  if ($am.Success) {
    $attName = $am.Groups[1].Value
    Check "${id}: вложение названо примером" ($attName -match 'example\.html$') $attName
    $bytes = [Convert]::FromBase64String(($am.Groups[2].Value -replace '\s', ''))
    $attText = [Text.Encoding]::UTF8.GetString($bytes)
    $srcPath = Join-Path $out ("sample\" + $attName)
    if (Test-Path $srcPath) {
      $srcText = [IO.File]::ReadAllText($srcPath, [Text.Encoding]::UTF8)
      Check "${id}: вложение идентично примеру" ($attText -eq $srcText) ("att={0} src={1}" -f $attText.Length, $srcText.Length)
    } else { Check "${id}: исходник примера найден" $false $srcPath }
    Check "${id}: вложение помечено как пример" ($attText -match 'ЭТО ПРИМЕР САЙТА')
    Check "${id}: вложение без неподставленных плейсхолдеров" ($attText -notmatch '\{\{[A-Z0-9_]+\}\}')
  } else { Check "${id}: вложение найдено" $false }

  # второе вложение: админ-панель (обещана в письме под тариф 1000-2000)
  $bm = [regex]::Match($raw, '(?s)Content-Disposition: attachment; filename="([^"]*admin[^"]*)"\r?\n\r?\n(.*?)\r?\n--mix-')
  if ($bm.Success) {
    $admText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($bm.Groups[2].Value -replace '\s', '')))
    Check "${id}: админка декодируется" ($admText.Length -gt 2000) ("len=" + $admText.Length)
    Check "${id}: админка помечена как пример" ($admText -match 'ЭТО ПРИМЕР АДМИН-ПАНЕЛИ')
    Check "${id}: в админке есть заявки и заказы" ($admText -match 'Заявки с сайта' -and $admText -match 'Заказы')
    Check "${id}: админка без плейсхолдеров" ($admText -notmatch '\{\{[A-Z0-9_]+\}\}')
  } else { Check "${id}: админка приложена" $false }

  # Письмо обязано называть ИМЕННО СВОИ вложения. Баг был такой: в шаблоне и в
  # make-eml.ps1 стояло жёсткое d001-example.html, поэтому получатели d002-d006
  # читали в письме имя файла, которого во вложении не было.
  $pm = [regex]::Match($raw, '(?s)--alt-[a-f0-9]+\r?\nContent-Type: text/plain.*?\r?\n\r?\n(.*?)\r?\n\r?\n--alt-')
  if ($pm.Success) {
    $ptxt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($pm.Groups[1].Value -replace '\s', '')))
    $named = @([regex]::Matches($ptxt, 'd\d{3}(-admin)?-example\.html') | ForEach-Object { $_.Value } | Sort-Object -Unique)
    Check "${id}: письмо называет свой пример" ($named -contains "${id}-example.html") ($named -join ', ')
    Check "${id}: письмо называет свою админку" ($named -contains "${id}-admin-example.html") ($named -join ', ')
    # и не упоминает чужие вложения
    $foreign = @($named | Where-Object { $_ -notlike "$id-*" })
    Check "${id}: письмо не ссылается на чужие файлы" ($foreign.Count -eq 0) ($foreign -join ', ')
    # имя в тексте должно совпадать с именем реально приложенного файла
    if ($am.Success) { Check "${id}: имя в тексте = имя во вложении" ($ptxt -match [regex]::Escape($am.Groups[1].Value)) $am.Groups[1].Value }
  }
}

Write-Host ''
Write-Host ("ИТОГО: pass={0} fail={1}" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }
