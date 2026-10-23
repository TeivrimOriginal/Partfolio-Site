<#
  test-send-wave.ps1 — проверка того, что send-smtp.ps1 правильно раскладывает
  письма по ящикам, БЕЗ реальной отправки и без сети.

  Что проверяем:
    1. DryRun с пулом печатает раскладку: сколько писем уйдёт с какого ящика
    2. DryRun с пулом НЕ требует паролей (иначе нельзя проверить план заранее)
    3. DryRun с битым пулом не падает, а пишет, что не прочитан
    4. DryRun с лимитом меньше числа писем прямо говорит, что лимит исчерпан
    5. Ничего не отправлено: sent-log.csv не изменился, писем в outbox не больше
    6. DryRun без пула (одиночный ящик) по-прежнему работает
    7. Запуск без пула и без пароля даёт внятную ошибку, а не молчание

  Работает на копиях репозитория во временной папке: реальный sent-log.csv,
  реальные письма и реальные ящики тест не трогает.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
$diagFile = Join-Path $root 'send-wave-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

$tmp = Join-Path $env:TEMP ('swave-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
function Run-Wave {
  param([string]$Dir, [string[]]$ScriptArgs)
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir 'send-smtp.ps1') @ScriptArgs 2>&1
  $code = $LASTEXITCODE
  return @{ text = ($out | Out-String); code = $code }
}

# ---- собираем рабочую копию: скрипты, индекс, письма, лог, конфиги preflight
$dir = Join-Path $tmp 'work'
New-Item -ItemType Directory -Path (Join-Path $dir 'outbox\sample') -Force | Out-Null
foreach ($f in @('send-smtp.ps1', 'mailbox-pool.ps1', 'preflight.ps1', 'pipeline.ps1')) {
  Copy-Item -Path (Join-Path $root $f) -Destination (Join-Path $dir $f) -Force
}
Copy-Item -Path (Join-Path $root 'deals.csv') -Destination (Join-Path $dir 'deals.csv') -Force -ErrorAction SilentlyContinue

$ids = @('w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7')
$idxRows = @()
$i = 0
foreach ($id in $ids) {
  $i++
  $txt = "Текст письма $id для проверки раскладки по ящикам."
  $txtB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($txt))
  $eml = @(
    "From: t@example.ru"
    "To: lead$i@example.com"
    "Subject: Тест $id"
    "MIME-Version: 1.0"
    "Content-Type: multipart/alternative; boundary=alt-abcdef01"
    ''
    "--alt-abcdef01"
    "Content-Type: text/plain; charset=utf-8"
    "Content-Transfer-Encoding: base64"
    ''
    $txtB64
    ''
    '--alt-abcdef01--'
  ) -join "`r`n"
  [IO.File]::WriteAllText((Join-Path $dir "outbox\$id.eml"), $eml, [Text.UTF8Encoding]::new($false))
  $idxRows += ('{0},lead{1}@example.com,Компания {1},"Тест {0}",w{1}-example.html,,,,' -f $id, $i)
}
$idxHeader = @('id', 'to', 'company', 'subject', 'attach', 'attach2', 'stage', 'date', 'note') -join ','
@($idxHeader) + $idxRows | Set-Content -Path (Join-Path $dir 'outbox\eml-index.csv') -Encoding UTF8
Copy-Item -Path (Join-Path $root 'sent-log.csv') -Destination (Join-Path $dir 'sent-log.csv') -Force

# preflight может валить запуск по причинам, не связанным с пулом. Нам нужен
# индекс писем и код выхода 0/3, поэтому заглушка: считаем, что допуск есть.
@'
param([Parameter(ValueFromRemainingArguments = $true)]$Rest)
Write-Host 'preflight: заглушка для теста'
exit 0
'@ | Set-Content -Path (Join-Path $dir 'preflight.ps1') -Encoding UTF8

# пул: 3 ящика, лимит 3 каждому = ровно 7 писем не помещается (9 мест)
$poolCsv = Join-Path $dir 'mailboxes.csv'
@'
name,user,host,port,daily_limit,pass_env,display_name
b1,b1@example.ru,smtp.yandex.ru,587,3,MAIL_PASS_T1,Тест Тестов
b2,b2@example.ru,smtp.yandex.ru,587,3,MAIL_PASS_T2,Тест Тестов
b3,b3@example.ru,smtp.yandex.ru,587,3,MAIL_PASS_T3,Тест Тестов
'@ | Set-Content -Path $poolCsv -Encoding UTF8

$logBefore = (Get-Item (Join-Path $dir 'sent-log.csv')).Length
$logHashBefore = (Get-FileHash (Join-Path $dir 'sent-log.csv') -Algorithm SHA256).Hash

Write-Host '=== send-smtp: раскладка по ящикам ==='

# --- 1, 2: план без паролей ---
$r = Run-Wave -Dir $dir -ScriptArgs @('-Mailboxes', 'mailboxes.csv', '-DryRun')
Write-Host ($r.text -split "`r?`n" | Select-Object -First 40 | ForEach-Object { '    | ' + $_ })
Check 'DryRun с пулом отработал без ошибки' ($r.code -eq 0) ('exit=' + $r.code)
Check 'DryRun не требует паролей' ($r.text -match 'ПАРОЛЯ НЕТ') 'в плане нет отметки о недостающих паролях'
Check 'в плане виден остаток лимита' ($r.text -match 'сегодня 0/3') 'нет строки с остатком лимита'
# строки плана вида "  w1 -> lead1@example.com   [b1]"
$b1 = ([regex]::Matches($r.text, '(?m)^\s+w\d+ -> \S+\s+\[b1\]')).Count
$b2 = ([regex]::Matches($r.text, '(?m)^\s+w\d+ -> \S+\s+\[b2\]')).Count
$b3 = ([regex]::Matches($r.text, '(?m)^\s+w\d+ -> \S+\s+\[b3\]')).Count
# 7 писем по кругу на три ящика: b1,b2,b3,b1,b2,b3,b1 -> 3/2/2, лимит 3 не превышен
Check 'раскладка по кругу: 3/2/2' (($b1 -eq 3) -and ($b2 -eq 2) -and ($b3 -eq 2)) ("b1=$b1 b2=$b2 b3=$b3")
Check 'ни один ящик не превысил лимит 3' (($b1 -le 3) -and ($b2 -le 3) -and ($b3 -le 3)) ("b1=$b1 b2=$b2 b3=$b3")
Check 'первое письмо ушло с первого ящика пула' ($r.text -match '(?m)^\s+w1 -> \S+\s+\[b1\]') 'первое письмо не с b1'
Check 'план покрывает 7 писем' (($b1 + $b2 + $b3) -eq $ids.Count) ("всего=" + ($b1 + $b2 + $b3))

# --- 4: лимит меньше числа писем ---
$r2 = Run-Wave -Dir $dir -ScriptArgs @('-Mailboxes', 'mailboxes.csv', '-DryRun', '-MaxPerDay', '1')
Check 'лимит 1 на ящик: план обрезан' ($r2.text -match 'ЛИМИТЫ ИСЧЕРПАНЫ' -and $r2.text -match 'покрывает 3 из 7') 'нет сообщения об исчерпанном лимите'

# --- 3: битый пул ---
$badCsv = Join-Path $dir 'bad.csv'
'user,host,port,daily_limit,pass_env' | Set-Content -Path $badCsv -Encoding UTF8
'x@example.ru,smtp.yandex.ru,587,10,' | Add-Content -Path $badCsv -Encoding UTF8
$r3 = Run-Wave -Dir $dir -ScriptArgs @('-Mailboxes', 'bad.csv', '-DryRun')
Check 'битый пул не роняет DryRun' ($r3.code -eq 0) ('exit=' + $r3.code)
Check 'битый пул назван по имени ящика/поля' ($r3.text -match 'ПУЛ НЕ ПРОЧИТАН') 'нет сообщения о непроверённом пуле'
$r4 = Run-Wave -Dir $dir -ScriptArgs @('-Mailboxes', 'net-takogo.csv', '-DryRun')
Check 'отсутствующий файл пула не роняет DryRun' ($r4.code -eq 0 -and $r4.text -match 'ПУЛ НЕ ПРОЧИТАН') ('exit=' + $r4.code)

# --- 5: ничего не отправлено ---
$logHashAfter = (Get-FileHash (Join-Path $dir 'sent-log.csv') -Algorithm SHA256).Hash
Check 'sent-log.csv не изменился' ($logHashAfter -eq $logHashBefore) 'DryRun тронул лог отправок'
$emls = @(Get-ChildItem (Join-Path $dir 'outbox') -Filter '*.eml')
Check 'писем в outbox столько же' ($emls.Count -eq $ids.Count) ('eml=' + $emls.Count)
$leaked = Select-String -Path (Join-Path $dir 'sent-log.csv') -Pattern 'w[1-7]' -ErrorAction SilentlyContinue
Check 'в лог не попало ни одного тестового письма' ($null -eq $leaked) 'DryRun записал отправку'

# --- 6: одиночный ящик, пула нет ---
$r5 = Run-Wave -Dir $dir -ScriptArgs @('-DryRun')
Check 'DryRun без пула работает как раньше' ($r5.code -eq 0 -and $r5.text -match 'w1 -> lead1@example.com') ('exit=' + $r5.code)

# --- 7: без пула и без пароля ---
$env:MAIL_USER = ''; $env:MAIL_PASS = ''
$r6 = Run-Wave -Dir $dir -ScriptArgs @('-DryRun', '-UseEnv')
Check 'без пула и без пароля — внятная ошибка' ($r6.code -ne 0 -or $r6.text -match 'MAIL_USER|MAIL_PASS|Credential') ('exit=' + $r6.code)

# --- 8: реальный пул без переменных окружения должен остановить запуск ---
$r7 = Run-Wave -Dir $dir -ScriptArgs @('-Mailboxes', 'mailboxes.csv')
Check 'без переменных с паролями отправка не стартует' ($r7.code -eq 3 -and $r7.text -match 'MAIL_PASS_T1') ('exit=' + $r7.code)
$logHash3 = (Get-FileHash (Join-Path $dir 'sent-log.csv') -Algorithm SHA256).Hash
Check 'неудачный запуск не тронул лог' ($logHash3 -eq $logHashBefore) 'лог изменён при отказе по паролю'

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -gt 0) {
  $fails -join "`r`n" | Set-Content -Path $diagFile -Encoding UTF8
  Write-Host ("FAIL {0} / PASS {1}  (подробности: {2})" -f $fail, $pass, $diagFile)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
