<#
  auto-daily.ps1 — ежедневный автопрогон без оператора.

  Что делает сам, по порядку:
    1. inbox   — imap-read.ps1: возвраты и ответы по каждому ящику пула
    2. find     — find-targets.ps1: новые цели в воронку
    3. due      — pipeline.ps1 due: что просрочено и назначено на сегодня
    4. prepare  — send-wave.ps1: готовит письма ровно тем сделкам, которым пора
    5. gate     — preflight.ps1: блокеры -> стоп, ничего не отправляется
    6. send     — send-smtp.ps1: отправка через пул ящиков с лимитами
    7. stats    — pipeline.ps1 stats: воронка и деньги итогом

  Чего НЕ делает (и почему это не лень, а невозможность):
    - не читает ответы и не ведёт переговоры: ответ клиента — это человек,
      шаблон тут закроет максимум "спасибо, пришлю вопросы"
    - не получает деньги: деньги — это договор, счёт, банк, налог. У скрипта
      нет подписи, счёта и личности. Оплата всегда за человеком
    - не звонит (этап B1): голосовой разговор не автоматизируется
    - не разбирает баунсы из почты: bounce-scan.ps1 ждёт вставленный текст
      отказа. Авточтение ящика по IMAP — отдельная работа, её пока нет

  Реалистичная цель: оператор тратит 15 минут в день только на ответы и деньги,
  всё остальное крутится само по расписанию (одна команда, см. -ShowSchedule).

  Коды выхода: 0 — всё прошло; 2 — блокеры preflight, ничего не отправлено;
  3 — нет паролей/конфига; 5 — отправка с частичными ошибками; 7 — уже запущено.

  Run:
    powershell -ExecutionPolicy Bypass -File auto-daily.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File auto-daily.ps1 -Limit 3
    powershell -ExecutionPolicy Bypass -File auto-daily.ps1 -ShowSchedule
#>
[CmdletBinding()]
param(
  [int]$Limit = 3,
  [int]$TargetPerDay = 3,      # сколько новых целей добавлять в воронку за день
  [string]$Mailboxes = '',
  [int]$MaxPerDay = 0,
  [switch]$DryRun,
  [switch]$Force,
  [switch]$ShowSchedule
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

if ($ShowSchedule) {
  $cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root 'auto-daily.ps1') + '" -Limit 3'
  Write-Host 'Автозапуск раз в день (выполнить ОДИН раз в своём терминале):'
  Write-Host ''
  Write-Host ('  schtasks /create /tn "SiteWaveDaily" /sc daily /st 09:00 /tr "' + $cmd + '"')
  Write-Host ''
  Write-Host 'Проверка расписания:  schtasks /query /tn "SiteWaveDaily"'
  Write-Host 'Удаление расписания:  schtasks /delete /tn "SiteWaveDaily" /f'
  exit 0
}

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$logPath = Join-Path $root ('auto-daily-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
function Write-Log([string]$m) {
  Write-Host $m
  try { ($stamp + '  ' + $m) | Add-Content -Path $logPath -Encoding UTF8 } catch { }
}

# Блокировка от повторного запуска: два автопрогона одновременно означают
# двойную отправку, а повторная отправка — это спам по второму кругу.
#
# Мёртвый lock — не повод останавливаться. Проверено на себе: прогон,
# прерванный вместе с родительским окном (pid 12612, 16:37), оставил lock
# навсегда, и система не запускалась больше ни разу. Поэтому lock хранит pid и
# время: если процесса нет или он висит дольше полутора часов, lock считается
# оставшимся от прерванного прогона, снимается, и работа продолжается.
$lockPath = Join-Path $root 'auto-daily.lock'
$lockMaxAgeMin = 90
if ((Test-Path $lockPath) -and -not $Force) {
  $lockRaw = ''
  try { $lockRaw = Get-Content -Path $lockPath -Raw -ErrorAction SilentlyContinue } catch { }
  $lockPid = 0
  $pm = [regex]::Match($lockRaw, 'pid=(\d+)')
  if ($pm.Success) { $lockPid = [int]$pm.Groups[1].Value }
  $alive = $false
  if ($lockPid -gt 0) { $alive = [bool](Get-Process -Id $lockPid -ErrorAction SilentlyContinue) }
  $ageMin = 999999
  $sm = [regex]::Match($lockRaw, 'started=([0-9\-]+ [0-9:]+)')
  if ($sm.Success) {
    try { $ageMin = [math]::Round(((Get-Date) - [datetime]::ParseExact($sm.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null)).TotalMinutes) } catch { }
  }
  if (-not $alive) {
    Write-Log ("lock от прерванного прогона (pid " + $lockPid + " не существует) — снимаю и продолжаю") -ForegroundColor DarkYellow
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
  } elseif ($ageMin -gt $lockMaxAgeMin) {
    Write-Log ("lock старый (" + $ageMin + " мин, процесс жив) — считаю зависшим, снимаю") -ForegroundColor DarkYellow
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
  } else {
    Write-Log ("УЖЕ ЗАПУЩЕНО: pid " + $lockPid + ", " + $ageMin + " мин назад. Если точно нет прошлого прогона — -Force")
    exit 7
  }
}
try { ("pid=" + $PID + " started=" + $stamp) | Set-Content -Path $lockPath -Encoding UTF8 } catch { }

function Invoke-Step {
  param([string]$Name, [string]$File, [string[]]$StepArgs)
  Write-Log ("--- шаг: " + $Name + " (" + (Split-Path $File -Leaf) + " " + ($StepArgs -join ' ') + ")")
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root $File) @StepArgs 2>&1
  $code = $LASTEXITCODE
  foreach ($line in @($out | Out-String -Width 200 -Stream | Where-Object { $_.Trim() } | Select-Object -Last 12)) {
    Write-Log ("    " + $line.Trim())
  }
  Write-Log ("--- шаг " + $Name + ": exit=" + $code)
  return $code
}

Write-Log ('===== автопрогон начат' + $(if ($DryRun) { ' (DryRun: отправки не будет)' } else { '' }) + ' =====')

$exitCode = 0

# 0. inbox: возвраты и ответы. Идёт ПЕРВЫМ, потому что откат по мёртвому
#    адресу должен случиться до того, как пайплайн начнёт готовить follow-up.
#    Именно так d004 провисел с возвратом от 03.10 до follow-up 07.10.
if (Test-Path (Join-Path $root 'imap-read.ps1')) {
  $boxes = @()
  $poolFile = if ($Mailboxes) { $Mailboxes } else { 'mailboxes.csv' }
  $poolFull = if ([IO.Path]::IsPathRooted($poolFile)) { $poolFile } else { Join-Path $root $poolFile }
  if (Test-Path $poolFull) {
    foreach ($b in @(Import-Csv $poolFull -Encoding UTF8 | Where-Object { $_.user })) {
      $smtpHost = if ($b.host) { $b.host.Trim() } else { 'smtp.yandex.ru' }
      $imapHost = $smtpHost -replace '^smtp\.', 'imap.'
      $boxes += @{ user = $b.user.Trim(); host = $imapHost; env = ($b.pass_env + '').Trim() }
    }
  } elseif ($env:MAIL_USER) {
    $boxes += @{ user = $env:MAIL_USER; host = ($env:MAIL_HOST_IMAP); env = 'MAIL_PASS' }
  }
  if ($boxes.Count -eq 0) {
    Write-Log 'inbox: ящики не заданы (нет mailboxes.csv и MAIL_USER) — разбор входящих пропущен'
  } else {
    foreach ($b in $boxes) {
      $ia = @('-User', $b.user, '-Host_', $b.host)
      if ($b.env) { $ia += @('-PassEnv', $b.env) }
      if ($DryRun) { $ia += '-DryRun' }
      $ic = Invoke-Step -Name ('inbox ' + $b.user) -File 'imap-read.ps1' -StepArgs $ia
      # код 3 (нет пароля) и 4 (не подключился) — не повод стопорить отправку:
      # письма всё равно уйдут, просто возвраты будут разбираться с задержкой
      if ($ic -ne 0) { Write-Log ("inbox " + $b.user + ": код " + $ic + ", продолжаю") }
    }
  }
}

# 1. подбор новых целей. Идёт после разбора входящих и ДО due, чтобы свежие
#    сделки попали в планы писем этого же дня.
#    Код 3 — «свежих целей нет». Это не поломка, а норма: база кончилась,
#    сборщик под троттлингом. Останавливать из-за этого всю цепочку нельзя —
#    follow-up по начатым сделкам всё равно надо отправить.
if (Test-Path (Join-Path $root 'find-targets.ps1')) {
  $fa = @('-PerDay', "$TargetPerDay")
  if ($DryRun) { $fa += '-DryRun' }
  $c = Invoke-Step -Name 'find' -File 'find-targets.ps1' -StepArgs $fa
  if ($c -eq 3) { Write-Log 'свежих целей нет — воронка пополнится сборщиком; отправка продолжается по начатым сделкам' }
  elseif ($c -ne 0) { Write-Log ('подбор целей не прошёл (код ' + $c + '), продолжаю') }
}

# 2. что делать сегодня (информационный, но падение пайплайна — повод встать:
# работать вслепую по битым сделкам хуже, чем не работать)
$c = Invoke-Step -Name 'due' -File 'pipeline.ps1' -StepArgs @('due')
if ($c -ne 0) { Write-Log 'пайплайн недоступен — дальше не иду'; $exitCode = 3 }

# 3. подготовка писем тем, кому пора
if ($exitCode -eq 0) {
  $prep = @('-Limit', "$Limit")
  if ($DryRun) { $prep += '-DryRun' }
  $c = Invoke-Step -Name 'prepare' -File 'send-wave.ps1' -StepArgs $prep
  if ($c -ne 0) { Write-Log 'подготовка писем не прошла — дальше не иду'; $exitCode = 3 }
}

# 4. допуск: блокеры означают кривые письма, отправка запрещена
if ($exitCode -eq 0) {
  $c = Invoke-Step -Name 'gate' -File 'preflight.ps1' -StepArgs @()
  if ($c -eq 2) { Write-Log 'БЛОКЕРЫ — отправка отменена'; $exitCode = 2 }
  elseif ($c -ne 0) { Write-Log 'проверка не прошла — дальше не иду'; $exitCode = 3 }
}

# 5. отправка через пул (пароли — из окружения, см. mailbox-pool.ps1)
if ($exitCode -eq 0) {
  $poolArg = $Mailboxes
  if (-not $poolArg) {
    $defaultPool = Join-Path $root 'mailboxes.csv'
    if (Test-Path $defaultPool) { $poolArg = 'mailboxes.csv' }
  }
  $send = @('-Limit', "$Limit")
  if ($poolArg) { $send += @('-Mailboxes', $poolArg) }
  if ($MaxPerDay -gt 0) { $send += @('-MaxPerDay', "$MaxPerDay") }
  if ($DryRun) { $send += '-DryRun' }
  $c = Invoke-Step -Name 'send' -File 'send-smtp.ps1' -StepArgs $send
  if ($c -eq 3) { Write-Log 'нет паролей/конфига — отправка не выполнена'; $exitCode = 3 }
  elseif ($c -eq 2) { Write-Log 'БЛОКЕРЫ при отправке — ничего не ушло'; $exitCode = 2 }
  elseif ($c -eq 5) { Write-Log 'отправка с частичными ошибками — смотрю итог'; $exitCode = 5 }
  elseif ($c -ne 0) { Write-Log ("неизвестный код отправки: " + $c); $exitCode = $c }
}

# 6. итог: воронка и деньги (идёт всегда, даже после частичных ошибок —
# иначе не будет видно, что вообще произошло)
$c = Invoke-Step -Name 'stats' -File 'pipeline.ps1' -StepArgs @('stats')
if ($c -ne 0 -and $exitCode -eq 0) { $exitCode = 3 }

try { Remove-Item $lockPath -Force -ErrorAction SilentlyContinue } catch { }
Write-Log ("===== автопрогон закончен: exit=" + $exitCode + " =====")
if ($exitCode -eq 0 -and -not $DryRun) {
  Write-Log 'Поставил на расписание один раз — дальше само: auto-daily.ps1 -ShowSchedule'
}
exit $exitCode
