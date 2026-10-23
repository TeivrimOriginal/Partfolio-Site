<#
  test-smtp-login.ps1 — проверка Test-SenderLogin против НАСТОЯЩИХ почтовых
  серверов, с заведомо неверными паролями. Письма не отправляются: проверка
  заканчивается на AUTH LOGIN и QUIT, это 3 команды, ни одного письма.

  Зачем это нужно. Весь пул ящиков держится на этой функции: если она всегда
  возвращает ok=$true, отправка пойдёт с непроверенными ящиками и упадёт уже
  после того, как первое письмо напечатано в лог. Если она всегда ok=$false,
  пул из 5 ящиков не запустится никогда. Проверять это на глаз нельзя — нужен
  фактический ответ сервера.

  Сеть используется только здесь и только на чтение: EHLO / STARTTLS /
  AUTH LOGIN / QUIT.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
. (Join-Path $root 'mailbox-pool.ps1')

$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

Write-Host '=== SMTP-логин против настоящих серверов (отправки нет) ==='

# 1. несуществующий домен -> ok=$false, а не исключение и не зависание
$dead = @{
  name = 'dead'; user = 'a@b.ru'; pass = 'x'
  host = 'smtp.this-host-does-not-exist-9f3a.invalid'; port = 587
  daily_limit = 5; display_name = 't'
}
$sw = [Diagnostics.Stopwatch]::StartNew()
$r1 = Test-SenderLogin -Sender $dead -TimeoutMs 15000
$sw.Stop()
Check 'несуществующий хост отклонён' ($r1.ok -eq $false) ('ok=' + $r1.ok)
Check 'несуществующий хост не hangs' ($sw.Elapsed.TotalSeconds -lt 40) ('секунд=' + [math]::Round($sw.Elapsed.TotalSeconds, 1))

# 2. настоящий сервер, заведомо неверный пароль -> сервер обязан ответить 535
$yandex = @{
  name = 'y'; user = 'probe-account-9f3a@example.ru'; pass = 'wrong-password-9f3a'
  host = 'smtp.yandex.ru'; port = 587
  daily_limit = 5; display_name = 't'
}
$r2 = Test-SenderLogin -Sender $yandex -TimeoutMs 20000
Write-Host ('    smtp.yandex.ru:587 -> ' + $r2.detail)
if ($r2.ok) {
  Write-Host '  ВНИМАНИЕ: сервер принял несуществующий ящик с неверным паролем.' -ForegroundColor Red
  Check 'yandex отклоняет неверный пароль' $false $r2.detail
} elseif ($r2.detail -match 'НЕ СОЕДИНИЛОСЬ') {
  # сети может не быть — это не дефект функции, но и не подтверждение
  Write-Host '  сеть недоступна, проверка ответа сервера пропущена' -ForegroundColor DarkYellow
} else {
  Check 'yandex отклоняет неверный пароль' ($r2.detail -match 'ЛОГИН НЕ ПРИНЯТ' -and $r2.detail -match '5\d\d') $r2.detail
}

# 3. настоящий сервер, порт 465 (implicitness TLS) — ветка отдельная, её тоже надо тронуть
$gmail465 = @{
  name = 'g'; user = 'probe-account-9f3a@gmail.com'; pass = 'wrong-password-9f3a'
  host = 'smtp.gmail.com'; port = 465
  daily_limit = 5; display_name = 't'
}
$r3 = Test-SenderLogin -Sender $gmail465 -TimeoutMs 20000
Write-Host ('    smtp.gmail.com:465 -> ' + $r3.detail)
if ($r3.detail -match 'НЕ СОЕДИНИЛОСЬ') {
  Write-Host '  сеть недоступна или порт закрыт, ветка 465 не проверена' -ForegroundColor DarkYellow
} else {
  Check 'порт 465 даёт внятный отказ' ($r3.ok -eq $false) $r3.detail
}

# 4. функция обязана возвращать структуру, а не строку и не $null
Check 'возвращается hashtable с ok/detail' (($r2 -is [hashtable]) -and ($null -ne $r2.ok) -and ($null -ne $r2.detail)) (($r2 | Out-String).Trim())

Write-Host ''
if ($fail -gt 0) {
  Write-Host ("FAIL {0} / PASS {1}" -f $fail, $pass)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
