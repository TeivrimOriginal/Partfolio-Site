<#
  test-auto-daily.ps1 — проверка автопрогона БЕЗ сети и БЕЗ отправки.

  Что проверяем (каждый пункт — способ молча выстрелить себе в ногу):
    1. DryRun проходит все 5 шагов по порядку и заканчивается кодом 0
    2. sent-log.csv после DryRun байт-в-байт тот же (план не отправляет)
    3. lock-файл после прогона снят (иначе следующий запуск не стартует никогда)
    4. лог дня создан и в нём видны все шаги
    5. блокер preflight останавливает цепочку ДО отправки (exit 2, send не звался)
    6. занятый lock останавливает всё сразу (exit 7, send не звался)
    7. -ShowSchedule печатает команду планировщика и ничего не запускает
    8. реальный запуск без паролей останавливается на отправке (exit 3),
       до этого шаги прошли, лог не тронут

  Работает на копии репозитория во временной папке: боевые sent-log, письма
  и ящики тест не трогает. Настоящие берутся только auto-daily.ps1,
  send-smtp.ps1 и mailbox-pool.ps1; остальные шаги — заглушки с теми же именами.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
$diagFile = Join-Path $root 'auto-daily-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

function New-WorkDir {
  $tmp = Join-Path $env:TEMP ('adaily-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $dir = Join-Path $tmp 'work'
  New-Item -ItemType Directory -Path (Join-Path $dir 'outbox') -Force | Out-Null
  foreach ($f in @('auto-daily.ps1', 'send-smtp.ps1', 'mailbox-pool.ps1')) {
    Copy-Item -Path (Join-Path $root $f) -Destination (Join-Path $dir $f) -Force
  }
  # заглушка разбора входящих: сети нет, но шаг обязан вызваться и по порядку
  @'
param([string]$User = '', [string]$Host_ = '', [string]$PassEnv = '', [switch]$DryRun, [Parameter(ValueFromRemainingArguments = $true)]$Rest)
Write-Host ("STUB imap user=" + $User + " host=" + $Host_ + " dry=" + $DryRun)
exit 0
'@ | Set-Content -Path (Join-Path $dir 'imap-read.ps1') -Encoding UTF8
  # заглушка подбора целей: шаг обязан вызваться вторым и принять -PerDay
  @'
param([int]$PerDay = 0, [switch]$DryRun, [switch]$Collect, [Parameter(ValueFromRemainingArguments = $true)]$Rest)
Write-Host ("STUB find perday=" + $PerDay + " dry=" + $DryRun)
exit 0
'@ | Set-Content -Path (Join-Path $dir 'find-targets.ps1') -Encoding UTF8
  # заглушки шагов: те же имена и аргументы, сети и побочных эффектов нет
  @'
param([string]$Cmd = '', [Parameter(ValueFromRemainingArguments = $true)]$Rest)
Write-Host ("STUB pipeline cmd=" + $Cmd)
exit 0
'@ | Set-Content -Path (Join-Path $dir 'pipeline.ps1') -Encoding UTF8
  @'
param([int]$Limit = 0, [switch]$DryRun, [Parameter(ValueFromRemainingArguments = $true)]$Rest)
Write-Host ("STUB send-wave limit=" + $Limit + " dry=" + $DryRun)
exit 0
'@ | Set-Content -Path (Join-Path $dir 'send-wave.ps1') -Encoding UTF8
  @'
$code = 0
if ($env:AUTODAILY_STUB_PREFLIGHT) { $code = [int]$env:AUTODAILY_STUB_PREFLIGHT }
Write-Host ("STUB preflight exit=" + $code)
exit $code
'@ | Set-Content -Path (Join-Path $dir 'preflight.ps1') -Encoding UTF8
  # настоящее preflight внутри send-smtp подменяется заглушкой через тот же env
  $env:AUTODAILY_STUB_PREFLIGHT = ''
  # два письма и индекс под них
  $idxRows = @()
  foreach ($id in @('w1', 'w2')) {
    $txtB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("Текст письма $id для автопрогона."))
    $eml = @(
      "From: t@example.ru", "To: lead@$id.example.com", "Subject: Тест $id",
      "MIME-Version: 1.0", "Content-Type: multipart/alternative; boundary=alt-abcdef01", '',
      "--alt-abcdef01", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", '',
      $txtB64, '', '--alt-abcdef01--'
    ) -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $dir "outbox\$id.eml"), $eml, [Text.UTF8Encoding]::new($false))
    $idxRows += ('{0},lead@{0}.example.com,Компания {0},"Тест {0}",{0}-example.html,,,,' -f $id)
  }
  @(@('id', 'to', 'company', 'subject', 'attach', 'attach2', 'stage', 'date', 'note') -join ',') + $idxRows |
    Set-Content -Path (Join-Path $dir 'outbox\eml-index.csv') -Encoding UTF8
  @(@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach', 'from') -join ',') |
    Set-Content -Path (Join-Path $dir 'sent-log.csv') -Encoding UTF8
  Copy-Item -Path (Join-Path $root 'deals.csv') -Destination (Join-Path $dir 'deals.csv') -Force
  @'
name,user,host,port,daily_limit,pass_env,display_name
b1,b1@example.ru,smtp.yandex.ru,587,5,MAIL_PASS_T1,Тест Тестов
b2,b2@example.ru,smtp.yandex.ru,587,5,MAIL_PASS_T2,Тест Тестов
'@ | Set-Content -Path (Join-Path $dir 'mailboxes.csv') -Encoding UTF8
  return @{ tmp = $tmp; dir = $dir }
}

function Run-Auto {
  param([string]$Dir, [string[]]$ScriptArgs)
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Dir 'auto-daily.ps1') @ScriptArgs 2>&1
  return @{ text = ($out | Out-String); code = $LASTEXITCODE }
}

Write-Host '=== auto-daily ==='

# --- 1-4: полный DryRun ---
$w = New-WorkDir
$logHash0 = (Get-FileHash (Join-Path $w.dir 'sent-log.csv') -Algorithm SHA256).Hash
$r = Run-Auto -Dir $w.dir -ScriptArgs @('-DryRun', '-Limit', '2')
$order = @('шаг: inbox', 'шаг: find', 'шаг: due', 'шаг: prepare', 'шаг: gate', 'шаг: send', 'шаг: stats')
$pos = -1; $ordered = $true
foreach ($s in $order) {
  $p = $r.text.IndexOf($s)
  if ($p -le $pos) { $ordered = $false; break }
  $pos = $p
}
Check 'DryRun проходит 7 шагов по порядку, inbox первым' ($r.code -eq 0 -and $ordered) ('exit=' + $r.code)
Check 'подбор целей идёт вторым шагом и получает -PerDay' ($r.text -match 'STUB find perday=3') 'шаг find не вызван или без PerDay'
Check 'inbox вызывается для каждого ящика пула' (([regex]::Matches($r.text, 'шаг: inbox b1@')).Count -eq 1 -and ([regex]::Matches($r.text, 'шаг: inbox b2@')).Count -eq 1) 'ящики пула не все разобраны'
Check 'imap-хост выводится из smtp-хоста (smtp.yandex.ru -> imap.yandex.ru)' ($r.text -match 'host=imap\.yandex\.ru') 'imap-хост не выведен'
Check 'DryRun не трогает sent-log' ((Get-FileHash (Join-Path $w.dir 'sent-log.csv') -Algorithm SHA256).Hash -eq $logHash0) 'лог отправок изменился'
Check 'lock снят после прогона' (-not (Test-Path (Join-Path $w.dir 'auto-daily.lock'))) 'lock остался — следующий запуск не стартует'
$dayLog = Join-Path $w.dir ('auto-daily-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
Check 'лог дня создан со всеми шагами' ((Test-Path $dayLog) -and ((Get-Content $dayLog -Raw) -match 'шаг: send')) 'лога нет'
Remove-Item $w.tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- 5: блокер останавливает до отправки ---
$w = New-WorkDir
$logHash0 = (Get-FileHash (Join-Path $w.dir 'sent-log.csv') -Algorithm SHA256).Hash
$env:AUTODAILY_STUB_PREFLIGHT = '2'
$r = Run-Auto -Dir $w.dir -ScriptArgs @('-DryRun', '-Limit', '2')
$env:AUTODAILY_STUB_PREFLIGHT = ''
Check 'блокер даёт exit 2' ($r.code -eq 2) ('exit=' + $r.code)
Check 'при блокере send не вызывается' ($r.text -notmatch 'шаг: send') 'отправка пошла мимо гейта'
Check 'при блокере лог цел' ((Get-FileHash (Join-Path $w.dir 'sent-log.csv') -Algorithm SHA256).Hash -eq $logHash0) 'лог изменился'
Remove-Item $w.tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- 6: занятый lock ---
$w = New-WorkDir
# lock от ЖИВОГО процесса: текущий pid, свежее время — так выглядит настоящий
# параллельный прогон, и его обязано блокировать
("pid=" + $PID + " started=" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) |
  Set-Content -Path (Join-Path $w.dir 'auto-daily.lock') -Encoding UTF8
$r = Run-Auto -Dir $w.dir -ScriptArgs @('-DryRun')
Check 'занятый lock даёт exit 7' ($r.code -eq 7) ('exit=' + $r.code)
Check 'при занятом lock шаги не идут' ($r.text -notmatch 'шаг: due') 'шаги пошли поверх работающего прогона'
Remove-Item $w.tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- 6b: lock от прерванного прогона (процесса уже нет) ---
# Именно это состояние осталось после прогона 16:37, убитого вместе с окном:
# система не смогла бы запуститься больше никогда.
$w = New-WorkDir
# pid 999999 заведомо не существует; время — свежее, чтобы проверка упала именно
# на «процесса нет», а не на «lock старый»
("pid=999999 started=" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) |
  Set-Content -Path (Join-Path $w.dir 'auto-daily.lock') -Encoding UTF8
$r = Run-Auto -Dir $w.dir -ScriptArgs @('-DryRun')
Check 'мёртвый lock не блокирует систему' ($r.code -eq 0 -and $r.text -match 'шаг: due') ('exit=' + $r.code)
Check 'о снятии мёртвого lock сказано в логе' ($r.text -match 'lock от прерванного прогона') 'нет сообщения'
Remove-Item $w.tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- 6c: lock старше 90 минут от живого процесса (зависший прогон) ---
$w = New-WorkDir
$old = (Get-Date).AddMinutes(-200).ToString('yyyy-MM-dd HH:mm:ss')
("pid=" + $PID + " started=" + $old) | Set-Content -Path (Join-Path $w.dir 'auto-daily.lock') -Encoding UTF8
$r = Run-Auto -Dir $w.dir -ScriptArgs @('-DryRun')
Check 'зависший lock старше 90 минут снимается' ($r.code -eq 0 -and $r.text -match 'считаю зависшим') ('exit=' + $r.code)
Remove-Item $w.tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- 7: расписание ---
$w = New-WorkDir
$r = Run-Auto -Dir $w.dir -ScriptArgs @('-ShowSchedule')
Check 'ShowSchedule печатает команду и ничего не запускает' ($r.code -eq 0 -and $r.text -match 'schtasks' -and $r.text -match 'auto-daily\.ps1' -and $r.text -notmatch 'шаг: due') ('exit=' + $r.code)
Check 'ShowSchedule не создаёт lock' (-not (Test-Path (Join-Path $w.dir 'auto-daily.lock'))) 'lock создан показом расписания'
Remove-Item $w.tmp -Recurse -Force -ErrorAction SilentlyContinue

# --- 8: реальный запуск без паролей встаёт на отправке ---
$w = New-WorkDir
$logHash0 = (Get-FileHash (Join-Path $w.dir 'sent-log.csv') -Algorithm SHA256).Hash
$r = Run-Auto -Dir $w.dir -ScriptArgs @('-Limit', '2')
Check 'без паролей exit 3' ($r.code -eq 3 -and $r.text -match 'MAIL_PASS_T1') ('exit=' + $r.code)
Check 'шаги до отправки прошли' (($r.text -match 'шаг: find') -and ($r.text -match 'шаг: due') -and ($r.text -match 'шаг: gate')) 'цепочка оборвалась раньше отправки'
Check 'неудачная отправка не пишет в лог' ((Get-FileHash (Join-Path $w.dir 'sent-log.csv') -Algorithm SHA256).Hash -eq $logHash0) 'лог тронут отказом по паролю'
Remove-Item $w.tmp -Recurse -Force -ErrorAction SilentlyContinue

Remove-Item env:AUTODAILY_STUB_PREFLIGHT -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -gt 0) {
  $fails -join "`r`n" | Set-Content -Path $diagFile -Encoding UTF8
  Write-Host ("FAIL {0} / PASS {1}  (подробности: {2})" -f $fail, $pass, $diagFile)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
