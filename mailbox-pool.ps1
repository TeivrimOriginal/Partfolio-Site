<#
  mailbox-pool.ps1 — пул отправляющих ящиков: несколько почт вместо одной.

  Зачем. Одна почта на несколько десятков холодных писем в день — это ровно тот
  сценарий, за который Google и Яндекс банят аккаунт без возможности вернуть.
  Разделение волны на 3-5 пустых ящиков на одном домене снижает риск и даёт
  продолжить, когда один ящик уже отработал свой дневной лимит.

  Что здесь нет и не должно быть: паролей. В CSV лежит ИМЯ переменной
  окружения (pass_env), а сам пароль/код приложения берётся из окружения при
  запуске. Файл с паролями в репозитории — это и есть тот компромисс, из-за
  которого потом уезжает доступ ко всему остальному.

  Формат mailboxes.csv:
    name,user,host,port,daily_limit,pass_env,display_name
    box1,sales1@domen.ru,smtp.yandex.ru,587,40,MAIL_PASS_BOX1,Данила Арсеньев
    box2,sales2@domen.ru,smtp.yandex.ru,587,40,MAIL_PASS_BOX2,Данила Арсеньев

  Дневной лимит на ящик обязателен. Без него пул превращается в способ уронить
  все ящики за один заход, и это недопустимо.

  Функции используются и из send-smtp.ps1, и из test-mailbox-pool.ps1 (юнит-тест
  крутится локально, без сети и без паролей).
#>

<#
  Приведение sent-log.csv к схеме с колонкой from.

  Почему это отдельная функция, а не «просто добавили поле в Export-Csv».
  Проверено на PowerShell 5.1 (тот, что в системе): Export-Csv -Append НЕ
  расширяет шапку файла. Если в шапке 8 колонок, а в объекте 9, девятая
  молча выбрасывается на диск, и учёт отправок по ящикам после этого невозможен
  вообще — файл выглядит целым, данные в нём есть, а колонки from в нём нет.
  Поэтому шапку приводим один раз явно и всегда с резервной копией.
#>
function Ensure-SentLogSchema {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Column = 'from',
    [string[]]$Columns = @('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach', 'from')
  )
  if (-not (Test-Path $Path)) {
    ($Columns -join ',') | Set-Content -Path $Path -Encoding UTF8
    return @{ changed = $true; rows = 0; backup = ''; note = 'создан новый лог' }
  }
  $raw = @(Get-Content -Path $Path -Encoding UTF8 | Where-Object { $_.Trim() })
  if ($raw.Count -eq 0) {
    ($Columns -join ',') | Set-Content -Path $Path -Encoding UTF8
    return @{ changed = $true; rows = 0; backup = ''; note = 'пустой лог перезаписан' }
  }
  $header = ($raw[0] -replace '"', '').Split(',') | ForEach-Object { $_.Trim() }
  if ($header -contains $Column) { return @{ changed = $false; rows = $raw.Count - 1; backup = ''; note = 'колонка уже есть' } }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = "$Path.bak-$stamp"
  Copy-Item -Path $Path -Destination $backup -Force

  $old = @{}
  foreach ($h in $header) { $old[$h] = $true }
  $lines = New-Object System.Collections.ArrayList
  [void]$lines.Add(($Columns -join ','))
  $n = 0
  for ($i = 1; $i -lt $raw.Count; $i++) {
    $line = $raw[$i]
    if (-not $line.Trim()) { continue }
    $parsed = @($line | ConvertFrom-Csv -Header @($header + 'H1') -ErrorAction SilentlyContinue)
    if ($parsed.Count -eq 0) { [void]$lines.Add($line); continue }
    $r = $parsed[0]
    $vals = New-Object System.Collections.ArrayList
    foreach ($c in $Columns) {
      $v = ''
      if ($old.ContainsKey($c)) { $v = ($r.$c + '') } else { $v = '' }
      [void]$vals.Add(('"' + $v.Replace('"', '""') + '"'))
    }
    [void]$lines.Add(($vals -join ','))
    $n++
  }
  $lines | Set-Content -Path $Path -Encoding UTF8
  return @{ changed = $true; rows = $n; backup = $backup; note = ("добавлена колонка " + $Column) }
}

# Один ящик как пул длиной 1 — чтобы вызывающий код не знал, один их или нет.
function New-SingleSender {
  param(
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Pass,
    [string]$Host_ = 'smtp.yandex.ru',
    [int]$Port = 587,
    [int]$DailyLimit = 40,
    [string]$Name = 'single',
    [string]$DisplayName = ''
  )
  @{
    name = $Name
    user = $User
    pass = $Pass
    host = $Host_
    port = $Port
    daily_limit = $DailyLimit
    display_name = if ($DisplayName) { $DisplayName } else { 'Данила Арсеньев' }
  }
}

<#
  Импорт пула из CSV. Падает (throw), если файл битый, обязательное поле пустое
  или для ящика не задана переменная окружения с паролем. Молча пропускать
  нельзя: иначе раундротин тихо отключит половину ящиков, и это выяснится
  через сутки, когда письма уйдут с одного ящика.
#>
function Import-SenderPool {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$MaxPerDay = 0,
    [switch]$AllowMissingPass
  )
  if (-not (Test-Path $Path)) { throw "файл пула не найден: $Path" }
  $rows = @(Import-Csv -Path $Path -Encoding UTF8 | Where-Object { $_.user -and $_.user.Trim() })
  if ($rows.Count -eq 0) { throw "в пуле нет ни одного ящика: $Path" }

  $pool = New-Object System.Collections.ArrayList
  $n = 0
  foreach ($r in $rows) {
    $n++
    $user = $r.user.Trim()
    $envName = ($r.pass_env + '').Trim()
    if (-not $envName) { throw "ящик #$n ($user): пустое поле pass_env — пароль брать неоткуда" }
    $pass = [Environment]::GetEnvironmentVariable($envName)
    if (-not $pass -and -not $AllowMissingPass) {
      throw "ящик #$n ($user): переменная окружения $envName пуста или не задана"
    }
    $port = 587
    if ($r.port -and -not [int]::TryParse(($r.port + '').Trim(), [ref]$port)) { throw "ящик #$n ($user): port не число: $($r.port)" }
    $limit = 40
    if ($r.daily_limit -and -not [int]::TryParse(($r.daily_limit + '').Trim(), [ref]$limit)) { throw "ящик #$n ($user): daily_limit не число: $($r.daily_limit)" }
    if ($MaxPerDay -gt 0) { $limit = $MaxPerDay }
    if ($limit -le 0) { throw "ящик #$n ($user): дневной лимит должен быть больше нуля" }
    [void]$pool.Add(@{
        name = if ($r.name) { $r.name.Trim() } else { $user }
        user = $user
        pass = $pass
        host = if ($r.host) { $r.host.Trim() } else { 'smtp.yandex.ru' }
        port = $port
        daily_limit = $limit
        display_name = if ($r.display_name) { $r.display_name.Trim() } else { 'Данила Арсеньев' }
      })
  }
  return $pool
}

<#
  Сколько писем ящик уже отправил сегодня. Считаем по sent-log.csv: там есть
  колонка from, которую пишет send-smtp.ps1. Статус 'sent-mistake' тоже считаем —
  письмо ушло, репутацию ящика оно уже съело.
#>
function Get-SenderUsage {
  param(
    [Parameter(Mandatory = $true)]$Pool,
    [string]$SentLog = '',
    [string]$Date = (Get-Date -Format 'yyyy-MM-dd')
  )
  $usage = @{}
  foreach ($s in $Pool) { $usage[$s.user] = 0 }
  if (-not $SentLog) { return $usage }
  if (-not (Test-Path $SentLog)) { return $usage }
  foreach ($row in @(Import-Csv -Path $SentLog -Encoding UTF8)) {
    if (-not $row.sent_at -or -not ($row.sent_at -like "$Date*")) { continue }
    if ($row.status -notlike 'sent*') { continue }
    $from = ($row.from + '').Trim()
    if (-not $from) { $from = ($row.mail_user + '').Trim() }   # логи старого формата
    if (-not $from) { continue }
    if (-not $usage.ContainsKey($from)) { continue }
    $usage[$from] = $usage[$from] + 1
  }
  return $usage
}

<#
  Рундротин: выдаёт следующий ящик, у которого не выбран дневной лимит.
  Возвращает @{ sender = ...; cursor = N; reason = '' } либо sender = $null с
  причиной. cursor двигается по кругу — при одинаковых лимитах письма идут
  ящик1, ящик2, ящик3, ящик1... а не сначала весь ящик1.
#>
function Select-Sender {
  param(
    [Parameter(Mandatory = $true)]$Pool,
    [Parameter(Mandatory = $true)]$Usage,
    [int]$Cursor = 0
  )
  $n = @($Pool).Count
  if ($n -eq 0) { return @{ sender = $null; cursor = $Cursor; reason = 'пул пуст' } }
  for ($i = 0; $i -lt $n; $i++) {
    $idx = ($Cursor + $i) % $n
    $s = $Pool[$idx]
    $used = if ($Usage.ContainsKey($s.user)) { [int]$Usage[$s.user] } else { 0 }
    if ($used -lt $s.daily_limit) {
      return @{ sender = $s; cursor = ($idx + 1) % $n; reason = '' }
    }
  }
  $lim = (@($Pool | ForEach-Object { "$($_.name)=$($_.daily_limit)" }) -join ', ')
  return @{ sender = $null; cursor = $Cursor; reason = "дневные лимиты исчерпаны ($lim)" }
}

# Клиенты SMTP кэшируются по user: одна TLS-сессия на ящик, а не на письмо.
function Get-SenderClient {
  param(
    [Parameter(Mandatory = $true)]$Cache,
    [Parameter(Mandatory = $true)]$Sender
  )
  if ($Cache.ContainsKey($Sender.user)) { return $Cache[$Sender.user] }
  $c = New-Object System.Net.Mail.SmtpClient($Sender.host, $Sender.port)
  $c.EnableSsl = $true
  $c.DeliveryMethod = [System.Net.Mail.SmtpDeliveryMethod]::Network
  $c.Timeout = 30000
  $c.Credentials = New-Object System.Net.NetworkCredential($Sender.user, $Sender.pass)
  $Cache[$Sender.user] = $c
  return $c
}

<#
  Логин проверяем напрямую по TLS тем же способом, каким шла отправка на
  .NET 9+: SmtpClient.Connect() там удалён, зато STARTTLS руками работает.
  Возвращает @{ ok = $true/$false; detail = '...' } — вызывающий сам решает,
  валить всё или пропустить один ящик.
#>
function Test-SenderLogin {
  param(
    [Parameter(Mandatory = $true)]$Sender,
    [int]$TimeoutMs = 20000
  )
  $tcp = $null; $ssl = $null
  try {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    $ar = $tcp.BeginConnect($Sender.host, $Sender.port, $null, $null)
    if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs)) { throw 'таймаут соединения' }
    $tcp.EndConnect($ar)
    $stream = $tcp.GetStream(); $stream.ReadTimeout = $TimeoutMs; $stream.WriteTimeout = $TimeoutMs
    if ($Sender.port -eq 465) {
      # Тип именно System.Net.Security.SslStream. System.IO.Security — это
      # опечатка, которая была в старом блоке проверки в send-smtp.ps1: тип не
      # существует, попадает в catch и печатается как «НЕ СОЕДИНИЛОСЬ», то есть
      # проверка логина молча ничего не проверяла, а отправка продолжалась.
      $ssl = [System.Net.Security.SslStream]::new($stream, $false, ({$true} -as [System.Net.Security.RemoteCertificateValidationCallback]))
      $ssl.AuthenticateAsClient($Sender.host)
      $null = [System.IO.StreamReader]::new($ssl).ReadLine()
    } else {
      $rd0 = [System.IO.StreamReader]::new($stream)
      $wr0 = [System.IO.StreamWriter]::new($stream); $wr0.AutoFlush = $true
      $null = $rd0.ReadLine()
      $wr0.WriteLine('EHLO probe')
      while ($true) { $l = $rd0.ReadLine(); if ($null -eq $l -or $l -match '^\d{3} ') { break } }
      $wr0.WriteLine('STARTTLS'); $null = $rd0.ReadLine()
      $ssl = [System.Net.Security.SslStream]::new($stream, $false, ({$true} -as [System.Net.Security.RemoteCertificateValidationCallback]))
      $ssl.AuthenticateAsClient($Sender.host)
    }
    $rd = [System.IO.StreamReader]::new($ssl)
    $wr = [System.IO.StreamWriter]::new($ssl); $wr.AutoFlush = $true
    $wr.WriteLine('EHLO probe')
    while ($true) { $l = $rd.ReadLine(); if ($null -eq $l -or $l -match '^\d{3} ') { break } }
    $wr.WriteLine('AUTH LOGIN'); $null = $rd.ReadLine()
    $wr.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Sender.user))); $null = $rd.ReadLine()
    $wr.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Sender.pass)))
    $authLine = $rd.ReadLine()
    try { $wr.WriteLine('QUIT') } catch { }
    if ($authLine -like '235*') { return @{ ok = $true; detail = 'логин принят' } }
    return @{ ok = $false; detail = "ЛОГИН НЕ ПРИНЯТ: $authLine" }
  } catch {
    return @{ ok = $false; detail = ("НЕ СОЕДИНИЛОСЬ: " + $_.Exception.Message) }
  } finally {
    try { if ($ssl) { $ssl.Dispose() } } catch { }
    try { if ($tcp) { $tcp.Close() } } catch { }
  }
}
