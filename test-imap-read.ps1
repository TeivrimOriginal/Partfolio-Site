<#
  test-imap-read.ps1 — проверка разбора входящих БЕЗ сети.

  Что проверяем (каждый пункт — реальная ошибка классификации, которая стоит
  либо отправленного баунса в живого клиента, либо потерянного ответа):
    1. отказ Gmail (Undelivered Mail Returned to Sender) -> bounce, адрес-цель найден
    2. отказ Яндекса (неизвестный локальныйpart) -> bounce, адрес-цель найден
    3. возврат с цитатой исходного письма внутри -> всё равно bounce, НЕ reply
    4. ящик переполнен (552) -> bounce, но НЕ ставим z1 автоматически
    5. out of office -> autoreply, НЕ reply (иначе это разговор с роботом)
    6. автоответ, цитирующий наше письмо целиком -> autoreply, не reply
    7. живой ответ -> reply, адрес отправителя извлечён
    8. письмо без адресов и без признаков -> other, не выдумываем
    9. адрес-цель баунса достаётся из X-Original-To / final-recipient
   10. DryRun на живом баунсе НЕ трогает deals.csv и dead-addresses.csv
   11. реальный прогон баунса ставит z1 и пишет dead-addresses.csv (изолированно)
   12. живой ответ пишется в inbox-replies.csv (изолированно)
   13. код выхода 3 без ящика, 2 без файла

  Тест работает в отдельной папке: реальные imap-read.ps1, pipeline.ps1 и
  боевой deals.csv не трогаются, все доски копируются во временный каталог.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
$diagFile = Join-Path $root 'imap-read-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

$tmp = Join-Path $env:TEMP ('imapr-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$dir = Join-Path $tmp 'work'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
Copy-Item -Path (Join-Path $root 'imap-read.ps1') -Destination (Join-Path $dir 'imap-read.ps1') -Force
Copy-Item -Path (Join-Path $root 'pipeline.ps1') -Destination (Join-Path $dir 'pipeline.ps1') -Force
# Своя доска сделок, а не копия боевой: тест проверяет ЭФФЕКТ (д004 должна
# перейти в z1 именно от этого баунса). На боевой копии d004 уже была в z1,
# и проверка проходила, ничего не сделав.
@(
  (@('id', 'stage', 'stage_entered', 'next_action_date', 'next_action', 'company', 'inn', 'city',
      'okved', 'score', 'email', 'phone', 'source_url', 'value_rub', 'prepay_rub', 'paid_rub',
      'sent_date', 'reply_date', 'notes') -join ',')
  'd002,a2,2026-10-03,2026-10-07,follow-up 1,ООО ЭКСПРЕСС,2323016650,Абинск,Строительство,,52048-2012@mail.ru,,,,,2026-10-03,,'
  'd003,a2,2026-10-03,2026-10-07,follow-up 1,ООО АЛЬФА,2407010599,Богучаны,Строительство,,baranova-1962@mail.ru,,,,,2026-10-03,,'
  'd004,a2,2026-10-03,2026-10-07,follow-up 1,ООО КОНС,2466055150,Красноярск,Торговля,,24mpe@mail.ru,,,,,2026-10-03,,'
  'd005,a2,2026-10-03,2026-10-07,follow-up 1,ООО КОНСАЛТИНГ,2508011302,Находка,Торговля,,land7777@yandex.ru,,,,,2026-10-03,,'
) | Set-Content -Path (Join-Path $dir 'deals.csv') -Encoding UTF8

function Classify {
  param([string]$Raw, [string[]]$Own = @())
  # классификатор живёт внутри imap-read.ps1, а скрипт умеет только -File.
  # Поэтому разбираем через сам скрипт и берём вид из его вывода.
  $f = Join-Path $tmp 'msg.eml'
  [IO.File]::WriteAllText($f, $Raw, [Text.UTF8Encoding]::new($false))
  $a = @('-File', $f, '-DryRun')
  if ($Own.Count -gt 0) { $a += @('-OwnAddresses') + $Own }
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'imap-read.ps1') @a 2>&1
  $text = ($out | Out-String)
  $kind = ([regex]::Match($text, '\[(\w+)\]')).Groups[1].Value.ToLower()
  $addr = ([regex]::Match($text, 'адрес:\s*(\S+)')).Groups[1].Value
  $id = [pscustomobject]@{ kind = $kind; address = $addr; text = $text }
  return $id
}

Write-Host '=== imap-read: классификация входящих ==='

# --- 1. возврат Gmail ---
$gmailBounce = @'
From: mailer-daemon@googlemail.com
To: box1@example.ru
Subject: Undelivered Mail Returned to Sender
Content-Type: multipart/report; report-type=delivery-status

--b
Content-Type: text/plain

The following message to <aspmk@astranet.ru> was undeliverable.

    remote host said: 550 5.1.1 The email account that you tried to reach does not exist.
--b
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $gmailBounce
Check 'возврат Gmail -> bounce' ($r.kind -eq 'bounce') $r.kind
Check 'возврат Gmail: адрес-цель найден' ($r.address -eq 'aspmk@astranet.ru') $r.address
Check 'возврат Gmail: код SMTP извлечён' ($r.text -match '5\.1\.1') 'код не показан'

# --- 2. возврат Яндекса ---
$yandexBounce = @'
From: MAILER-DAEMON@yandex.ru
To: box1@example.ru
Subject: Undelivered Mail Returned to Sender

Следующее сообщение не было доставлено:
    24mpe@mail.ru

Почтовый сервер: 550 5.2.1 user is terminated
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $yandexBounce
Check 'возврат Яндекса -> bounce' ($r.kind -eq 'bounce') $r.kind
Check 'возврат Яндекса: адрес-цель найден' ($r.address -eq '24mpe@mail.ru') $r.address

# --- 3. возврат с цитатой нашего письма внутри (ловушка: выглядит как ответ) ---
$tricky = @'
From: postmaster@astranet.ru
To: box1@example.ru
Subject: Returned mail: see transcript for details

The original message headers:
From: box1@example.ru
To: aspmk@astranet.ru
Subject: Сайт для ООО АСПМК-3 от 500 руб - пример во вложении

Здравствуйте! Меня зовут Данила, я делаю сайты...

 550 5.1.1 User unknown
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $tricky
Check 'возврат с цитатой письма -> bounce, не reply' ($r.kind -eq 'bounce') $r.kind

# --- 4. ящик переполнен: адрес жив, z1 ставить нельзя ---
$full = @'
From: postmaster@mx.example.com
To: box1@example.ru
Subject: Mailbox full

552 5.2.2 Mailbox full
Final-Recipient: rfc822; land7777@yandex.ru
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $full
Check 'переполненный ящик распознан как bounce' ($r.kind -eq 'bounce') $r.kind
Check 'переполненный ящик виден как отдельный код' ($r.text -match '552') ('виден код: ' + $r.text)

# --- 5. out of office ---
$ooo = @'
From: director@buildco.ru
To: box1@example.ru
Subject: Out of office

I am currently out of the office with limited access to email.
I will reply when I return.
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $ooo
Check 'out of office -> autoreply' ($r.kind -eq 'autoreply') $r.kind
Check 'out of office -> адрес отправителя' ($r.address -eq 'director@buildco.ru') $r.address
Check 'out of office -> этап не двигается' ($r.text -match 'этап не двигаем') 'нет пометки'

# --- 6. автоответ от чужого робота с цитатой ---
$robot = @'
From: no-reply@company.ru
To: box1@example.ru
Subject: Автоматический ответ: ваше письмо получено

Ваше сообщение:
> Здравствуйте! Меня зовут Данила, я делаю сайты для небольших предприятий.
> Ваш город — Астрахань.

Мы ответим в течение 24 часов.
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $robot
Check 'робот с цитатой -> autoreply, не reply' ($r.kind -eq 'autoreply') $r.kind

# --- 7. живой ответ ---
$live = @'
From: baranova-1962@mail.ru
To: box1@example.ru
Subject: Re: Сайт для ООО АЛЬФА

Добрый день. Пришлите, пожалуйста, пример, посмотрим.
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $live
Check 'живой ответ -> reply' ($r.kind -eq 'reply') $r.kind
Check 'живой ответ: адрес отправителя' ($r.address -eq 'baranova-1962@mail.ru') $r.address
Check 'живой ответ: сказано, что читает человек' ($r.text -match 'ДЕЙСТВИЕ ЧЕЛОВЕКА') 'нет пометки'

# --- 8. мусор и наши собственные письма ---
$junk = "From: box1@example.ru`r`nTo: box1@example.ru`r`nSubject: test`r`n`r`nничего особенного`r`n"
$r = Classify -Raw $junk -Own @('box1@example.ru')
Check 'наше собственное письмо -> own, не reply' ($r.kind -eq 'own') $r.kind
$other = "From: noreply@newsletter.example`r`nTo: box1@example.ru`r`nSubject: digest`r`n`r`nподборка новостей`r`n"
$r = Classify -Raw $other
Check 'письмо без признаков -> не reply' ($r.kind -ne 'reply') $r.kind

# --- 9. адрес-цель из final-recipient ---
$finalRec = @'
From: postmaster@mx.example.com
To: box1@example.ru
Subject: Delivery Status Notification

Final-Recipient: rfc822; magazinruss00@mail.ru
Action: failed
Status: 5.0.0
 550 5.1.1 user unknown
'@ -replace "`r?`n", "`r`n"
$r = Classify -Raw $finalRec
Check 'адрес-цель из final-recipient' ($r.address -eq 'magazinruss00@mail.ru') $r.address

# --- 10. DryRun не трогает боевые доски ---
$dealsHash0 = (Get-FileHash (Join-Path $dir 'deals.csv') -Algorithm SHA256).Hash
$deadPath = Join-Path $dir 'dead-addresses.csv'
@(
  (@('email', 'id', 'company', 'inn', 'smtp', 'bounced_at', 'sent_at') -join ',')
  'aspmk@astranet.ru,d001,ООО АСПМК-3,3018000021,550,2026-10-03 21:15:01,2026-10-03'
) | Set-Content -Path $deadPath -Encoding UTF8
$deadHash0 = (Get-FileHash $deadPath -Algorithm SHA256).Hash
$repliesPath = Join-Path $dir 'inbox-replies.csv'
$g = Join-Path $tmp 'g.eml'
[IO.File]::WriteAllText($g, $gmailBounce, [Text.UTF8Encoding]::new($false))
$null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'imap-read.ps1') -File $g -DryRun 2>&1
Check 'DryRun не меняет deals.csv' ((Get-FileHash (Join-Path $dir 'deals.csv') -Algorithm SHA256).Hash -eq $dealsHash0) 'deals.csv изменён в DryRun'
Check 'DryRun не меняет dead-addresses.csv' ((Get-FileHash $deadPath -Algorithm SHA256).Hash -eq $deadHash0) 'список мёртвых изменён в DryRun'
Check 'DryRun не создаёт inbox-replies.csv' (-not (Test-Path $repliesPath)) 'файл ответов создан в DryRun'

# --- 11. реальный прогон баунса: z1 + запись в dead-addresses ---
$l = Join-Path $tmp 'l.eml'
[IO.File]::WriteAllText($l, $yandexBounce, [Text.UTF8Encoding]::new($false))
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'imap-read.ps1') -File $l 2>&1
$z = @(Import-Csv (Join-Path $dir 'deals.csv') -Encoding UTF8 | Where-Object { $_.id -eq 'd004' })[0]
Check 'реальный баунс ставит z1' ($z.stage -eq 'z1') $z.stage
Check 'код SMTP с пробелом дошёл до pipeline' (($out | Out-String) -match 'z1') (($out | Out-String) -split "`r?`n" | Select-Object -First 4)
$deadNow = @(Import-Csv $deadPath -Encoding UTF8)
Check 'реальный баунс пишет адрес' (@($deadNow | Where-Object { $_.email -eq '24mpe@mail.ru' }).Count -eq 1) ('строк с адресом: ' + @($deadNow | Where-Object { $_.email -eq '24mpe@mail.ru' }).Count)
Check 'баунс не плодит дубли' ($deadNow.Count -eq 2) ('строк всего: ' + $deadNow.Count)
$other2 = @(Import-Csv (Join-Path $dir 'deals.csv') -Encoding UTF8 | Where-Object { $_.id -eq 'd002' })[0]
Check 'чужие сделки баунс не тронул' ($other2.stage -eq 'a2') $other2.stage

# --- 11b. переполненный ящик НЕ вычёркивает живого человека ---
$fullFile = Join-Path $tmp 'full.eml'
[IO.File]::WriteAllText($fullFile, $full, [Text.UTF8Encoding]::new($false))
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'imap-read.ps1') -File $fullFile 2>&1
$still = @(Import-Csv (Join-Path $dir 'deals.csv') -Encoding UTF8 | Where-Object { $_.id -eq 'd005' })[0]
Check 'переполненный ящик не ставит z1' ($still.stage -eq 'a2') $still.stage
Check 'переполненный ящик записан в mailbox-full.csv' (Test-Path (Join-Path $dir 'mailbox-full.csv')) 'файла нет'

# --- 12. живой ответ пишется в inbox-replies.csv ---
$lv = Join-Path $tmp 'live.eml'
[IO.File]::WriteAllText($lv, $live, [Text.UTF8Encoding]::new($false))
$null = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'imap-read.ps1') -File $lv 2>&1
Check 'живой ответ записан в inbox-replies.csv' (Test-Path $repliesPath) 'файла нет'
if (Test-Path $repliesPath) {
  $rows = @(Import-Csv $repliesPath -Encoding UTF8)
  Check 'в файле одна строка с верным адресом' ($rows.Count -eq 1 -and $rows[0].from -eq 'baranova-1962@mail.ru') ("строк=" + $rows.Count + " from=" + $rows[0].from)
  Check 'вид ответа помечен как reply' ($rows[0].kind -eq 'reply') $rows[0].kind
}

# --- 13. коды выхода ---
$o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'imap-read.ps1') 2>&1
Check 'без ящика exit 3' ($LASTEXITCODE -eq 3) ('exit=' + $LASTEXITCODE)
$o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'imap-read.ps1') -File (Join-Path $tmp 'net-takogo.eml') 2>&1
Check 'нет файла exit 2' ($LASTEXITCODE -eq 2) ('exit=' + $LASTEXITCODE)

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -gt 0) {
  $fails -join "`r`n" | Set-Content -Path $diagFile -Encoding UTF8
  Write-Host ("FAIL {0} / PASS {1}  (подробности: {2})" -f $fail, $pass, $diagFile)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
