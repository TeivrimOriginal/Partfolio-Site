<#
  send-smtp.ps1 — реальная отправка писем по SMTP. Первая рабочая схема:
  ни реквизитов в проекте, ни клиента, ни релея не было, SMTP Gmail/Yandex есть.

  ГЛАВНОЕ ПРО ПАРОЛЬ. Он не должен приходить в чат, не должен попасть в .ps1,
  не должен лежать в NOTES.md или в логе. Здесь он вводится в защищённый
  приглашение Get-Credential и живёт только в памяти процесса. Либо можно
  задать переменную окружения MAIL_PASS на своей машине и не набирать вручную.

  Как выбрать ящик:
    Gmail  основной личный ящик — рискованно. Google банит аккаунты за холодную
           коммерческую рассылку, аккаунт восстановить почти невозможно, вместе
           с почтой и контактами.
    Yandex  отдельный пустой ящик на твоём имени — то, что нужно. Мягче к
           холодным письмам, и потеря такого ящика ничего не значит.
    Отдельный домен + Яндекс/VPS — идеально, но это на потом.

  Как использовать (пароль в чат не присылай!):
    powershell -ExecutionPolicy Bypass -File send-smtp.ps1 -Credential
    или один раз на своей машине:
    setx MAIL_USER "tvoi@pochta.ru"
    setx MAIL_PASS "app-password"
    powershell -ExecutionPolicy Bypass -File send-smtp.ps1 -UseEnv

  НЕСКОЛЬКО ЯЩИКОВ. Одна почта на десятки холодных писем в день — это ровно тот
  случай, за который банят без возврата. Несколько пустых ящиков на одном домене
  с разделением волны по дневным лимитам снижают риск и позволяют продолжить,
  когда один ящик уже отработал лимит. Описание пула — mailboxes.csv, пароли
  берутся из переменных окружения, которые в нём указаны (см. mailbox-pool.ps1):

    powershell -ExecutionPolicy Bypass -File send-smtp.ps1 -Mailboxes mailboxes.csv -Limit 10

  Перед отправкой обязательно прогоняется preflight.ps1. Если есть блокеры —
  отправка не идёт.

  Run:
    powershell -ExecutionPolicy Bypass -File send-smtp.ps1 -Credential -Limit 3
#>
[CmdletBinding()]
param(
  [string]$Index = 'outbox\eml-index.csv',
  [string]$DealsFile = 'deals.csv',
  [string]$SmtpHost = 'smtp.yandex.ru',
  [int]$SmtpPort = 587,
  [string]$User = '',
  [switch]$UseEnv,
  [switch]$Credential,
  [int]$Limit = 0,
  [int]$DelaySec = 45,
  [switch]$Html,
  [switch]$DryRun,
  [string]$Mailboxes = '',
  [int]$MaxPerDay = 0
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$indexPath = Join-Path $root $Index
$db = if ([IO.Path]::IsPathRooted($DealsFile)) { $DealsFile } else { Join-Path $root $DealsFile }
$sentLog = Join-Path $root 'sent-log.csv'

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
. (Join-Path $root 'mailbox-pool.ps1')

# ---------- 1. допуск ----------
Write-Host '=== допуск к отправке ===' -ForegroundColor Cyan
$pf = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'preflight.ps1') 2>&1
$pfCode = $LASTEXITCODE
($pf | Select-Object -Last 4) | ForEach-Object { Write-Host "  $_" }
if ($pfCode -eq 2) { Write-Host 'БЛОКЕРЫ - отправка не выполняется'; exit 2 }

# ---------- 2. что отправляем ----------
if (-not (Test-Path $indexPath)) { throw "нет индекса писем: $indexPath. Сначала make-eml.ps1 -All" }
$rows = @(Import-Csv $indexPath)
if ($rows.Count -eq 0) { Write-Host 'писем нет'; exit 0 }
if ($Limit -gt 0 -and $rows.Count -gt $Limit) { $rows = @($rows[0..($Limit - 1)]) }

# уже отправленные не трогаем
$already = @{}
if (Test-Path $sentLog) { foreach ($s in (Import-Csv $sentLog)) { if ($s.status -eq 'sent') { $already[$s.id] = $true } } }
$todo = @($rows | Where-Object { -not $already.ContainsKey($_.id) })
if ($todo.Count -eq 0) {
  Write-Host ("все {0} писем уже отправлены, повторно не трогаю" -f $rows.Count)
  exit 0
}

Write-Host ''
Write-Host ("к отправке: {0} писем" -f $todo.Count) -ForegroundColor Cyan
if (-not $DryRun -and $todo.Count -gt 1) {
  Write-Host ("пауза между письмами: {0} сек (burst с одного ящика - главная причина бана)" -f $DelaySec)
}

# ВАЖНО: миграция схемы sent-log НЕ выполняется в DryRun. DryRun не имеет
# права менять файлы: иначе «проверка плана» тихо правит боевой лог, и по
# результату прогона нельзя понять, что вообще отправлялось.

function Read-Part([string]$emlPath, [string]$kind) {
  if (-not (Test-Path $emlPath)) { return '' }
  $raw = [IO.File]::ReadAllText($emlPath, [Text.Encoding]::UTF8)
  $m = [regex]::Match($raw, "(?s)--alt-[a-f0-9]+\r?\nContent-Type: $kind; charset=utf-8\r?\nContent-Transfer-Encoding: base64\r?\n\r?\n(.*?)\r?\n\r?\n--alt-")
  if (-not $m.Success) { return '' }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($m.Groups[1].Value -replace '\s', '')))
}
# ---------- 3. реквизиты ----------
# DryRun показывает план и НЕ спрашивает пароль: иначе нельзя проверить
# логику, не имея под руками реального ящика.
if ($DryRun) {
  Write-Host ''
  Write-Host 'DryRun: план отправки, пароль не спрашивался, сеть не трогалась'

  # Пул показываем без паролей: -AllowMissingPass, иначе DryRun требовал бы
  # заданные переменные окружения и не проверял бы саму раскладку по ящикам.
  $plan = @()
  if ($Mailboxes) {
    $poolPath = if ([IO.Path]::IsPathRooted($Mailboxes)) { $Mailboxes } else { Join-Path $root $Mailboxes }
    try { $plan = Import-SenderPool -Path $poolPath -MaxPerDay $MaxPerDay -AllowMissingPass }
    catch { Write-Host ("  ПУЛ НЕ ПРОЧИТАН: " + $_.Exception.Message) -ForegroundColor Red }
  } else {
    $plan = @(New-SingleSender -User $(if ($User) { $User } else { 'MAIL_USER' }) -Pass 'dry' -Host_ $SmtpHost -Port $SmtpPort -DailyLimit $(if ($MaxPerDay -gt 0) { $MaxPerDay } else { 40 }))
  }

  if (@($plan).Count -gt 0) {
    $usage = Get-SenderUsage -Pool $plan -SentLog $sentLog
    Write-Host ''
    Write-Host '  ящики и остаток дневного лимита:'
    foreach ($s in $plan) {
      $used = if ($usage.ContainsKey($s.user)) { [int]$usage[$s.user] } else { 0 }
      $passState = if ($s.pass) { 'пароль есть' } else { 'ПАРОЛЯ НЕТ (DryRun не проверяет)' }
      Write-Host ("    {0,-10} {1,-28} сегодня {2}/{3}  {4}" -f $s.name, $s.user, $used, $s.daily_limit, $passState)
    }
    $cursor = 0
    $preview = @()
    $reason = ''
    foreach ($r in $todo) {
      $pick = Select-Sender -Pool $plan -Usage $usage -Cursor $cursor
      if ($null -eq $pick.sender) { $reason = $pick.reason; break }
      $cursor = $pick.cursor
      $usage[$pick.sender.user] = [int]$usage[$pick.sender.user] + 1
      $preview += [pscustomobject]@{
        id = $r.id; to = $r.to; subject = $r.subject
        attach = ((@($r.attach, $r.attach2) | Where-Object { $_ }) -join ', ')
        box = $pick.sender.name
      }
    }
    if ($preview.Count -lt $todo.Count) {
      Write-Host ("  ЛИМИТЫ ИСЧЕРПАНЫ: план покрывает {0} из {1} писем ({2})" -f $preview.Count, $todo.Count, $reason) -ForegroundColor Yellow
    }
    foreach ($p in $preview) {
      Write-Host ("  {0} -> {1}   [{2}]" -f $p.id, $p.to, $p.box)
      Write-Host ("      тема: {0}" -f $p.subject)
      Write-Host ("      вложения: {0}" -f $p.attach)
      $emlPath = Join-Path $root ('outbox\{0}.eml' -f $p.id)
      $txt = Read-Part $emlPath 'text/plain'
      Write-Host ("      текст прочитан: {0} симв., плейсхолдеров: {1}" -f $txt.Length, (@([regex]::Matches($txt, '\{\w+\}')).Count))
    }
  } else {
    # пул не прочитан: показываем хотя бы кому что уходит
    foreach ($r in $todo) { Write-Host ("  {0} -> {1}" -f $r.id, $r.to) }
  }
  exit 0
}

$user = $User
$pass = $null

# Режим пула: пароли всех ящиков лежат в переменных окружения, по одной на
# ящик. Ничего не спрашиваем — файла с паролями в проекте быть не должно.
if ($Mailboxes) {
  $poolPath = if ([IO.Path]::IsPathRooted($Mailboxes)) { $Mailboxes } else { Join-Path $root $Mailboxes }
  try {
    $pool = Import-SenderPool -Path $poolPath -MaxPerDay $MaxPerDay
  } catch {
    Write-Host ("ПУЛ НЕ ПРОЧИТАН: " + $_.Exception.Message) -ForegroundColor Red
    exit 3
  }
  Write-Host ''
  Write-Host ("пул ящиков: {0}" -f @($pool).Count) -ForegroundColor Cyan
  foreach ($s in $pool) {
    $have = if ($s.pass) { 'пароль есть' } else { 'ПАРОЛЯ НЕТ' }
    Write-Host ("  {0,-10} {1,-28} {2}:{3}  лимит/день {4}  ({5})" -f $s.name, $s.user, $s.host, $s.port, $s.daily_limit, $have)
  }
  $user = $pool[0].user
} elseif ($UseEnv -or ($env:MAIL_USER -and -not $Credential)) {
  $user = if ($user) { $user } else { $env:MAIL_USER }
  $pass = $env:MAIL_PASS
  if (-not $user -or -not $pass) {
    Write-Host 'MAIL_USER или MAIL_PASS не заданы. Задай через setx и перезапусти оболочку.' -ForegroundColor Red
    exit 3
  }
  Write-Host ("использую {0} из переменной окружения" -f $user)
} else {
  if (-not $Credential -and -not $user) { Write-Host 'укажи -Credential (ввод пароля вручную) или -UseEnv'; exit 3 }
  $credUser = if ($user) { $user } else { Read-Host 'Почтовый ящик (логин)' }
  if ($Credential) {
    # `Read-Host -AsSecureString` не возвращает пустое значение, а НАВСЕГДА
    # ВИСИТ в ожидании ввода - скрипт был зависшим 300 секунд.
    # Поэтому проверяем наличие настоящей консоли ДО запроса пароля.
    if ([Console]::IsInputRedirected) {
      Write-Host 'НЕТ ИНТЕРАКТИВНОЙ КОНСОЛИ: пароль ввести сюда нельзя.' -ForegroundColor Red
      Write-Host 'Скрипт был бы зависшим, а не спросил бы пароль.' -ForegroundColor DarkYellow
      Write-Host ''
      Write-Host 'Рабочий путь 1 - переменные окружения (пароль не попадает в чат):' -ForegroundColor Yellow
      Write-Host '   setx MAIL_USER "твой@ящик.ru"'
      Write-Host '   setx MAIL_PASS "код-приложения"'
      Write-Host '   потом скажи "готово", я запущу:  send-smtp.ps1 -UseEnv -Limit 3'
      Write-Host ''
      Write-Host 'Рабочий путь 2 - запусти сам из своего терминала:' -ForegroundColor Yellow
      Write-Host '   powershell -ExecutionPolicy Bypass -File send-smtp.ps1 -Credential -Limit 3'
      exit 3
    }
    Write-Host ''
    Write-Host 'Сейчас спросит пароль. Вводи его в окно, НЕ присылай в чат.' -ForegroundColor Yellow
    $sec = Read-Host -AsSecureString 'Пароль или код приложения'
    if ($null -eq $sec) { Write-Host 'ПАРОЛЬ НЕ ВВЕДЕН'; exit 3 }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $pass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if (-not $pass) { Write-Host 'ПАРОЛЬ ПУСТОЙ'; exit 3 }
  } else {
    $pass = $env:MAIL_PASS
    if (-not $pass) { throw 'MAIL_PASS не задан' }
  }
}

if ($DryRun) {
  Write-Host ''
  Write-Host 'DryRun: подключение не проверялось, ничего не отправлено'
  $todo | ForEach-Object { Write-Host ("  {0} -> {1}" -f $_.id, $_.to) }
  exit 0
}

# Одиночный ящик тоже оформляем пулом длиной 1: логика выбора и лимитов одна
# и та же, отдельная ветка была бы вторым местом, где можно забыть про лимит.
if (-not $Mailboxes) {
  $pool = @(New-SingleSender -User $user -Pass $pass -Host_ $SmtpHost -Port $SmtpPort -DailyLimit $(if ($MaxPerDay -gt 0) { $MaxPerDay } else { 40 }))
  $user = $pool[0].user
}

# ---------- 4. проверка SMTP-логина по каждому ящику ----------
# Проверяем ВСЕ ящики пула, а не только первый: упавший ящик выбрасываем из
# пула и отправляем оставшимися. Иначе один сдохший пароль останавливал бы
# весь запуск, хотя три других ящика готовы.
# без колонки from в sent-log учёт отправок по ящикам невозможен: Export-Csv
# -Append на 5.1 лишнюю колонку молча выбрасывает. Приводим схему один раз,
# с резервной копией, и только когда действительно идём в отправку.
$schema = Ensure-SentLogSchema -Path $sentLog
if ($schema.changed) {
  Write-Host ("sent-log: {0} (строк: {1}{2})" -f $schema.note, $schema.rows, $(if ($schema.backup) { ', копия: ' + (Split-Path $schema.backup -Leaf) } else { '' })) -ForegroundColor DarkYellow
}

$clientCache = @{}
$livePool = New-Object System.Collections.ArrayList
Write-Host ''
foreach ($s in $pool) {
  $used = 0
  if (Test-Path $sentLog) {
    $oneUsage = Get-SenderUsage -Pool @($s) -SentLog $sentLog
    if ($oneUsage.ContainsKey($s.user)) { $used = [int]$oneUsage[$s.user] }
  }
  if ($used -ge $s.daily_limit) {
    Write-Host ("  {0,-10} {1,-28} пропущен: лимит {2} уже выбран" -f $s.name, $s.user, $s.daily_limit) -ForegroundColor DarkYellow
    continue
  }
  Write-Host ("проверяю {0} ({1}) на {2}:{3} ..." -f $s.name, $s.user, $s.host, $s.port) -ForegroundColor Cyan
  # На .NET 9+ методы SmtpClient.Connect()/Authenticate() удалены, поэтому логин
  # проверяем напрямую по TLS (Test-SenderLogin), а отправка идёт через Send().
  $chk = Test-SenderLogin -Sender $s
  if ($chk.ok) {
    [void]$livePool.Add($s)
    Write-Host ('  логин принят сервером')
  } else {
    Write-Host ("  " + $chk.detail) -ForegroundColor Red
    Write-Host '  Частая причина - нужен не пароль, а код приложения (16 символов).' -ForegroundColor Yellow
  }
}
if (@($livePool).Count -eq 0) {
  Write-Host 'НИ ОДИН ЯЩИК НЕ ПРОШЁЛ ПРОВЕРКУ - отправка не выполняется' -ForegroundColor Red
  exit 4
}
if (@($livePool).Count -lt @($pool).Count) {
  Write-Host ("работаем с {0} из {1} ящиков" -f @($livePool).Count, @($pool).Count) -ForegroundColor Yellow
}
$pool = @($livePool)

# Клиенты создаются по первому обращению к ящику (Get-SenderClient) и живут до
# конца запуска: одна TLS-сессия на ящик, а не на письмо.
# Учётные данные проставляет Get-SenderClient. Без них Send() уходит без AUTH
# и Gmail отвечает 530 5.7.0.
# Старый инлайновый блок проверки логина удалён: он умел ровно один ящик и
# делал то же самое, что Test-SenderLogin, но без возможности отбросить
# нерабочий ящик и продолжить отправку остальными.


# ---------- 5. отправка ----------


$sentCount = 0
$failCount = 0
$usage = Get-SenderUsage -Pool $pool -SentLog $sentLog
$cursor = 0
$boxTally = @{}
foreach ($r in $todo) {
  $emlPath = Join-Path $root ('outbox\{0}.eml' -f $r.id)
  if (-not (Test-Path $emlPath)) {
    Write-Host ("  {0}: нет .eml, пропуск" -f $r.id) -ForegroundColor Yellow
    continue
  }
  $body = Read-Part $emlPath 'text/plain'
  $bodyHtml = Read-Part $emlPath 'text/html'
  if (-not $body) { Write-Host ("  {0}: не прочитан текст письма" -f $r.id) -ForegroundColor Red; continue }

  # ящик на каждое письмо: круговая ротация с учётом уже израсходованного лимита
  $pick = Select-Sender -Pool $pool -Usage $usage -Cursor $cursor
  if ($null -eq $pick.sender) {
    Write-Host ("  ОСТАНОВ: " + $pick.reason) -ForegroundColor Red
    Write-Host ("  отправлено {0}, ошибок {1}" -f $sentCount, $failCount) -ForegroundColor Yellow
    break
  }
  $cursor = $pick.cursor
  $sender = $pick.sender
  $client = Get-SenderClient -Cache $clientCache -Sender $sender

  $msg = New-Object System.Net.Mail.MailMessage
  $msg.From = New-Object System.Net.Mail.MailAddress($sender.user, $sender.display_name)
  $msg.To.Add($r.to)
  $msg.Subject = $r.subject
  $msg.SubjectEncoding = [Text.Encoding]::UTF8
  $msg.BodyEncoding = [Text.Encoding]::UTF8
  if ($Html -and $bodyHtml) { $msg.IsBodyHtml = $true; $msg.Body = $bodyHtml } else { $msg.IsBodyHtml = $false; $msg.Body = $body }

  foreach ($f in @($r.attach, $r.attach2)) {
    if (-not $f) { continue }
    $p = Join-Path $root ('outbox\sample\' + $f)
    if (-not (Test-Path $p)) { Write-Host ("    вложение не найдено: {0}" -f $p) -ForegroundColor Yellow; continue }
    $msg.Attachments.Add((New-Object System.Net.Mail.Attachment($p, 'text/html')))
  }

  try {
    $client.Send($msg)
    $sentCount++
    $usage[$sender.user] = [int]$usage[$sender.user] + 1
    if (-not $boxTally.ContainsKey($sender.name)) { $boxTally[$sender.name] = 0 }
    $boxTally[$sender.name] = $boxTally[$sender.name] + 1
    $rec = [pscustomobject]@{
      id = $r.id; to = $r.to; company = $r.company; subject = $r.subject
      sent_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); status = 'sent'; error = ''
      attach = ''; from = $sender.user
    }
    $rec | Export-Csv -Path $sentLog -NoTypeInformation -Encoding UTF8 -Append -Force
    Write-Host ("  ОТПРАВЛЕНО {0} -> {1}  ({2})  [{3}]" -f $r.id, $r.to, $r.company, $sender.name) -ForegroundColor Green
  } catch {
    $failCount++
    $rec = [pscustomobject]@{
      id = $r.id; to = $r.to; company = $r.company; subject = $r.subject
      sent_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); status = 'failed'; error = $_.Exception.Message
      attach = ''; from = $sender.user
    }
    $rec | Export-Csv -Path $sentLog -NoTypeInformation -Encoding UTF8 -Append -Force
    $inner = $_
    $chain = @()
    while ($null -ne $inner) { $chain += $inner.Message; $inner = $inner.InnerException }
    Write-Host ("  ОШИБКА {0} -> {1}: {2}" -f $r.id, $r.to, ($chain -join ' | ')) -ForegroundColor Red
  } finally {
    $msg.Dispose()
  }

  if ($sentCount + $failCount -lt $todo.Count) { Start-Sleep -Seconds $DelaySec }
}

foreach ($k in $clientCache.Keys) { try { $clientCache[$k].Dispose() } catch { } }
$clientCache.Clear()

# ---------- 6. сдвигаем этапы ----------
if ($sentCount -gt 0) {
  Write-Host ''
  Write-Host "отправлено: $sentCount, ошибок: $failCount"
  if ($boxTally.Count -gt 0) {
    Write-Host '  по ящикам:'
    foreach ($k in ($boxTally.Keys | Sort-Object)) { Write-Host ("    {0,-10} {1}" -f $k, $boxTally[$k]) }
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'pipeline.ps1') stage -Id $todo[0].id -To a2 2>&1 | Select-Object -First 1 | ForEach-Object { Write-Host "  $_" }
  Write-Host '  остальные сделки переведи вручную: pipeline.ps1 stage -Id d002 -To a2'
  Write-Host ''
  Write-Host 'Дальше follow-up 1 через 4 дня, follow-up 2 через 11, break-up через 18:'
  Write-Host '  powershell -ExecutionPolicy Bypass -File run-daily.cmd'
}
if ($failCount -gt 0) { exit 5 }
exit 0
