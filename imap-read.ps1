<#
  imap-read.ps1 — читает ящик сам и разбирает входящие на три потока.

  Зачем. Последнее ручное звено было простым: скопировать текст возврата и
  скормить bounce-scan.ps1. На автопрогоне это невозможно — возвраты приходят
  ночью, а копировать некому. Плюс человек в цикле неизбежно что-то пропустит,
  а пропущенный возврат означает follow-up в несуществующий ящик (д004 так и
  провисел до 04.10).

  Три потока, потому что они требуют разного:

    отказ (bounce)      → адрес мёртв, сделка z1, дальше не пишем. Автоматически
    автоответ (out of office, autoreply) → человек жив, но сейчас не готов.
                          Ответ откладываем, этап не двигаем. Автоматически
    живой ответ         → это разговор, дальше нужен человек. Пишем в
                          inbox-replies.csv и печатаем. Автоматически НЕЛЬЗЯ:
                          шаблонный ответ клиенту хуже, чем отсутствие ответа

  IMAP-клиент написан вручную на TcpClient + SslStream по той же причине,
  по которой так сделан Test-SenderLogin: в System.Net.Mail этого дотнета
  (Framework 4.x, PS 5.1) класса ImapClient нет вообще, проверено. Своя
  реализация — 5 команд протокола, без внешних сборок и установки пакетов.

  Отметка \Seen ставится ПОСЛЕ разбора, и только если разбор удался. Иначе
  письмо потерялось бы молча: помечено прочитанным, а сделка не тронута.

  Run:
    powershell -ExecutionPolicy Bypass -File imap-read.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File imap-read.ps1 -File письмо.eml   # разбор одного файла
    powershell -ExecutionPolicy Bypass -File imap-read.ps1 -Host imap.yandex.ru -User box1@domen.ru
#>
[CmdletBinding()]
param(
  [string]$Host_ = 'imap.yandex.ru',
  [int]$Port = 993,
  [string]$User = '',
  [string]$PassEnv = 'MAIL_PASS_BOX1',
  [string]$File = '',
  [string[]]$OwnAddresses = @(),
  [switch]$DryRun,
  [switch]$LeaveUnseen,     # не ставить \Seen (для отладки)
  [int]$MaxMessages = 50
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

# ---------- классификация письма ----------
<#
  Возвращает @{ kind = bounce|autoreply|reply|other; reason = '...'; target = '...' }
  target — адрес, о котором письмо на самом деле (для баунса это наш адрес,
  которому отказали; для автоответа и ответа это адрес отправителя).

  Порядок проверок важен: у возврата есть Subject вида «Undelivered Mail
  Returned to Sender», а тело с текстом письма внутри. Если сначала искать
  «живой ответ» по наличию слов в теле, автоответ с цитатой письма засчитался
  бы за ответ клиента. Поэтому сначала жёсткие признаки отказа.
#>
function Classify-Message {
  param([string]$Raw)
  $e = @{ kind = 'other'; reason = ''; target = '' }

  $subj = ''
  $sm = [regex]::Match($Raw, '(?im)^Subject:\s*(.+)$')
  if ($sm.Success) { $subj = $sm.Groups[1].Value.Trim() }
  $from = ''
  $fm = [regex]::Match($Raw, '(?im)^From:\s*(.+)$')
  if ($fm.Success) { $from = $fm.Groups[1].Value.Trim() }
  $fromAddr = ''
  if ($from -match '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})') { $fromAddr = $Matches[1].ToLower() }

  # --- наше собственное письмо (копия отправленного, автофорвард, BCC себе) ---
  # Обрабатывается ПЕРВЫМ. Иначе письмо, которое мы сами себе отправили или
  # которое вернулось копией через автофорвард, считалось бы ответом клиента.
  if ($fromAddr -and $OwnAddresses -contains $fromAddr) {
    $e.kind = 'own'
    $e.target = $fromAddr
    $e.reason = 'наше собственное письмо, не ответ'
    return $e
  }

  # --- отказ доставки ---
  # Отправитель-баунс — только mailer-daemon. Раньше в список попадал no-reply@,
  # и автоответ робота «мы ответим в течение 24 часов» помечался как отказ:
  # адрес объявлялся мёртвым, а человек был жив.
  $bounceSubj = '(?i)undelivered|delivery status notification|returned to sender|mail delivery failed|no such user|mailbox (not found|unavailable)|возврат|не доставлено'
  $bounceFrom = '(?i)^(mailer-daemon|mail-daemon)@'
  $bounceBody = '(?i)550\s+5\.(1\.[13]|2\.1|2\.2)|552\s|mbox unavailable|does not exist|user unknown|mailbox is full|recipient (address )?rejected'
  # postmaster@ и «rejected» в теме — признаки неоднозначные: postmaster пишет и
  # про отказы, и «мы на связи». Поэтому требуем второго подтверждения.
  $weakBounce = ($subj -match '(?i)rejected|bounced') -or ($fromAddr -eq 'postmaster@' -or $fromAddr -eq 'postmaster')
  if ($subj -match $bounceSubj -or $fromAddr -match $bounceFrom -or $Raw -match $bounceBody -or ($weakBounce -and $Raw -match $bounceBody)) {
    $e.kind = 'bounce'
    # Адрес, которому отказали. Смотрим ТОЛЬКО тело (после пустой строки) и
    # только два типа мест, где сервер честно пишет, кому не удалось:
    #   X-Original-To / Final-Recipient: rfc822; <адрес>
    #   "<адрес> was undeliverable" (Gmail) или "не было доставлено: <адрес>" (Яндекс)
    # Заголовки не смотрим принципиально: в To: возврата стоит наш собственный
    # адрес, и «первый адрес в тексте» — это всегда либо mailer-daemon, либо мы.
    $parts = ($Raw -split "(?:\r?\n)\r?\n", 2)
    $body = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    $cands = @()
    foreach ($m in [regex]::Matches($body, '(?i)(?:X-Original-To|Original-To|Final-Recipient)\s*:\s*(?:rfc822\s*;?\s*)?<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})')) {
      $cands += $m.Groups[1].Value
    }
    # ключевое слово, потом адрес (Яндекс: «не было доставлено:\n    адрес»)
    foreach ($m in [regex]::Matches($body, '(?im)(?:failed|rejected|not delivered|undeliverable|не (?:было )?доставлено|не существует|user unknown)[^\r\n]{0,120}?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})')) {
      $cands += $m.Groups[1].Value
    }
    # адрес, потом ключевое слово (Gmail: «to <адрес> was undeliverable»)
    foreach ($m in [regex]::Matches($body, '(?im)([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})[^\r\n]{0,80}?(?:was undeliverable|не доставлено|не удалось доставить|failed|rejected)')) {
      $cands += $m.Groups[1].Value
    }
    # запасной путь: любой адрес в теле, кроме служебного и нашего собственного
    if ($cands.Count -eq 0) {
      foreach ($m in [regex]::Matches($body, '(?i)([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})')) {
        $cands += $m.Groups[1].Value
      }
    }
    foreach ($c in $cands) {
      $lc = $c.ToLower()
      if ($lc -match '^(mailer-daemon|mail-daemon|postmaster|no-?reply)@') { continue }
      if ($OwnAddresses -contains $lc) { continue }
      $e.target = $lc
      break
    }
    $code = [regex]::Match($Raw, '(?i)\b(\d{3}\s+5\.\d+\.\d+)\b')
    $e.reason = if ($code.Success) { $code.Groups[1].Value } else { 'отказ доставки без кода' }
    if (-not $e.target) { $e.reason = $e.reason + ', адрес не распознан — сделку проверь руками' }
    return $e
  }


  # --- автоответ: человек есть, но сейчас недоступен ---
  $autoSubj = '(?i)out of (the )?office|automatic reply|auto(?:-)?reply|autoreply|away from|vacation|on holiday|безответное сообщение|уехал|отпуск|ваше письмо получено|мы ответим'
  $autoBody = '(?i)i am (currently )?(away|out of the office)|will (be )?(returning|back)|on vacation|responded slowly|received your (message|mail)|ответим в течение'
  $autoFrom = '(?i)no-?reply@|autoreply@|mailer-daemon@|postmaster@'
  if ($subj -match $autoSubj -or $Raw -match $autoBody) {
    $e.kind = 'autoreply'
    $e.target = $fromAddr
    $e.reason = 'человек ответил автоответом, диалог откладывается'
    return $e
  }

  # --- рассылка, от которой не ждут ответа ---
  # Проверяется ПОСЛЕ автоответа: адрес no-reply@company.ru с текстом «ответим в
  # течение 24 часов» — это автоответ человека, а не безответный робот.
  if ($fromAddr -match '(?i)^(no-?reply|noreply|do-?not-?reply|newsletter|digest|notification|notify|bounce)@') {
    $e.kind = 'other'
    $e.target = $fromAddr
    $e.reason = 'рассылка, отвечать некому и незачем'
    return $e
  }

  # --- живой ответ ---
  if ($fromAddr) {
    $e.kind = 'reply'
    $e.target = $fromAddr
    $e.reason = 'ответ человека, нужен разговор'
  }
  return $e
}

# ---------- разбор одного файла (без сети) ----------
function Handle-Raw {
  param([string]$Raw, [string]$SourceName)
  $cls = Classify-Message -Raw $Raw
  Write-Host ("[{0}] {1}  {2}" -f $cls.kind.ToUpper(), $SourceName, $cls.reason) -ForegroundColor $(switch ($cls.kind) { 'bounce' { 'Red' } 'autoreply' { 'Yellow' } 'reply' { 'Green' } 'own' { 'Magenta' } default { 'DarkGray' } })
  if ($cls.target) { Write-Host ("    адрес: " + $cls.target) }

  if ($cls.kind -eq 'bounce' -and $cls.target) {
    # Ящик переполнен (552) — адрес ЖИВ, человека нельзя вычёркивать. Такие
    # письма пишем в отдельный файл и НЕ двигаем сделку в z1: иначе один
    # переполненный ящик молча вычеркнет живого клиента из воронки.
    $isFull = ($cls.reason -match '^552') -or ($Raw -match '(?i)mailbox (is )?full')
    $fullPath = Join-Path $root 'mailbox-full.csv'
    if ($isFull) {
      if (-not $DryRun) {
        $hdr = 'seen_at,address,code,deal,note'
        if (-not (Test-Path $fullPath)) { $hdr | Set-Content -Path $fullPath -Encoding UTF8 }
        $recF = [pscustomobject]@{
          seen_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); address = $cls.target
          code = $cls.reason; deal = ''; note = 'ящик переполнен, человек жив, ждать'
        }
        $recF | Export-Csv -Path $fullPath -NoTypeInformation -Encoding UTF8 -Append
      }
      Write-Host '    ДЕЙСТВИЕ АВТОМАТА: адрес живой, в z1 НЕ переводим, ждать' -ForegroundColor Yellow
      return $cls
    }
    # ищем сделку по адресу и просим pipeline поставить z1
    $dealsPath = Join-Path $root 'deals.csv'
    if (Test-Path $dealsPath) {
      $hit = @(Import-Csv $dealsPath -Encoding UTF8 | Where-Object { $_.email -and ($_.email.ToLower() -eq $cls.target) })[0]
      if ($hit) {
        if ($DryRun) { Write-Host ("    DryRun: сделку " + $hit.id + " переведу в z1") -ForegroundColor DarkYellow }
        else {
          # Аргументы с пробелами передаём КАК ЕСТЬ, без добавленных кавычек.
          # Проверено экспериментом (_argprobe, 4 формы): powershell.exe -File сам
          # корректно экранирует «550 5.2.1» и «возврат из ящика: l.eml».
          # А вот обёртка вида '-Next "..."' ломает вызов: внешние кавычки
          # съедаются, и дочерний скрипт получает аргумент '-Id d004' целиком.
          $o = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'pipeline.ps1') bounce -Id $hit.id -Next $cls.reason -Note ("возврат из ящика: " + $SourceName) 2>&1
          $txt = (($o | Out-String -Width 160) -split "`r?`n" | Where-Object { $_.Trim() })
          foreach ($l in @($txt | Select-Object -First 3)) { Write-Host ("    " + $l.Trim()) }
          if (-not ($txt -join ' ') -match 'z1') {
            Write-Host '    ВНИМАНИЕ: pipeline не подтвердил перевод в z1 — сделку проверь руками' -ForegroundColor Red
          }
        }
      } else {
        Write-Host '    сделки по адресу в deals.csv нет — баунс записан только как факт' -ForegroundColor DarkYellow
      }
    }
  } elseif ($cls.kind -eq 'reply') {
    $repliesPath = Join-Path $root 'inbox-replies.csv'
    if (-not $DryRun) {
      # файл создаётся ТОЛЬКО на реальном прогоне: в DryRun не трогаем диск
      $hdr = 'seen_at,from,subject,kind,note'
      if (-not (Test-Path $repliesPath)) { $hdr | Set-Content -Path $repliesPath -Encoding UTF8 }
      $subj = [regex]::Match($Raw, '(?im)^Subject:\s*(.+)$')
      $rec = [pscustomobject]@{
        seen_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        from = $cls.target
        subject = ($subj.Groups[1].Value -replace ',', ' ').Trim()
        kind = $cls.kind
        note = 'ответ человека, разговор вручную'
      }
      $rec | Export-Csv -Path $repliesPath -NoTypeInformation -Encoding UTF8 -Append
    }
    Write-Host '    ДЕЙСТВИЕ ЧЕЛОВЕКА: прочитать и ответить' -ForegroundColor Yellow
  } elseif ($cls.kind -eq 'autoreply') {
    Write-Host '    ДЕЙСТВИЕ АВТОМАТА: этап не двигаем, вернуться к письму позже' -ForegroundColor DarkYellow
  } elseif ($cls.kind -eq 'own') {
    Write-Host '    ДЕЙСТВИЕ АВТОМАТА: это наше письмо, сделку не трогаем' -ForegroundColor DarkGray
  }
  return $cls
}

# ---------- режим одного файла: без сети ----------
if ($File) {
  if (-not (Test-Path $File)) { Write-Host ("нет файла: " + $File) -ForegroundColor Red; exit 2 }
  $raw = [IO.File]::ReadAllText($File, [Text.Encoding]::UTF8)
  $null = Handle-Raw -Raw $raw -SourceName (Split-Path $File -Leaf)
  exit 0
}

if (-not $User) {
  $User = $env:MAIL_USER
  if (-not $User) {
    Write-Host 'Не указан ящик. -User, или MAIL_USER в окружении, или -File <письмо> для разбора без сети.' -ForegroundColor Red
    exit 3
  }
}
$pass = [Environment]::GetEnvironmentVariable($PassEnv)
if (-not $pass) { $pass = $env:MAIL_PASS }
if (-not $pass) {
  Write-Host ("ПАРОЛЬ НЕ НАЙДЕН: переменная " + $PassEnv + " (или MAIL_PASS) пуста") -ForegroundColor Red
  exit 3
}

# ---------- IMAP: соединение и разбор ----------
$tcp = $null; $ssl = $null; $reader = $null; $writer = $null
function Imap-Send {
  param([string]$Line)
  $script:tag++
  $t = ('a' + $script:tag)
  $script:writer.WriteLine($t + ' ' + $Line)
  $script:writer.Flush()
  return $t
}
function Imap-Read {
  param([string]$Tag)
  $lines = @()
  while ($true) {
    $l = $script:reader.ReadLine()
    if ($null -eq $l) { break }
    $lines += $l
    if ($l -match ('^' + [regex]::Escape($Tag) + ' (OK|NO|BAD)')) { break }
  }
  return $lines
}

Write-Host ("=== IMAP: " + $User + " на " + $Host_ + ":" + $Port + " ===") -ForegroundColor Cyan
$script:tag = 0
try {
  $tcp = [System.Net.Sockets.TcpClient]::new()
  $ar = $tcp.BeginConnect($Host_, $Port, $null, $null)
  if (-not $ar.AsyncWaitHandle.WaitOne(25000)) { throw 'таймаут соединения' }
  $tcp.EndConnect($ar)
  $stream = $tcp.GetStream(); $stream.ReadTimeout = 60000; $stream.WriteTimeout = 60000
  $ssl = [System.Net.Security.SslStream]::new($stream, $false, ({$true} -as [System.Net.Security.RemoteCertificateValidationCallback]))
  $ssl.AuthenticateAsClient($Host_)
  $reader = [System.IO.StreamReader]::new($ssl)
  $writer = [System.IO.StreamWriter]::new($ssl); $writer.AutoFlush = $true
  $greet = $reader.ReadLine()
  Write-Host ('  сервер: ' + $greet)
} catch {
  Write-Host ('  НЕ ПОДКЛЮЧИЛОСЬ: ' + $_.Exception.Message) -ForegroundColor Red
  try { if ($ssl) { $ssl.Dispose() } } catch { }
  try { if ($tcp) { $tcp.Close() } } catch { }
  exit 4
}
$script:reader = $reader; $script:writer = $writer

try {
  $t = Imap-Send ('LOGIN "' + $User.Replace('"', '') + '" "' + $pass.Replace('"', '') + '"')
  $res = Imap-Read $t
  if (-not ($res -join "`n").StartsWith($t + ' OK')) {
    Write-Host ('  ЛОГИН НЕ ПРИНЯТ: ' + ($res | Select-Object -First 1)) -ForegroundColor Red
    $null = Imap-Send 'LOGOUT'
    exit 4
  }
  Write-Host '  логин принят' -ForegroundColor Green

  $t = Imap-Send 'SELECT INBOX'
  $sel = Imap-Read $t
  $unseen = 0
  $um = [regex]::Match(($sel -join "`n"), '(?im)UNSEEN\s+(\d+)')
  if ($um.Success) { $unseen = [int]$um.Groups[1].Value }
  Write-Host ("  непрочитанных: " + $unseen)

  if ($unseen -eq 0) {
    Write-Host '  новых писем нет' -ForegroundColor DarkYellow
    $null = Imap-Send 'LOGOUT'
    exit 0
  }

  $t = Imap-Send 'SEARCH UNSEEN'
  $sr = Imap-Read $t
  $ids = @()
  foreach ($l in $sr) {
    if ($l -match ('^' + [regex]::Escape($t) + ' SEARCH')) { continue }
    if ($l -match '^\* SEARCH') { $ids += @($l -replace '^\* SEARCH\s*','' -split '\s+' | Where-Object { $_ -match '^\d+$' }) }
  }
  $take = @($ids | Select-Object -First $MaxMessages)
  Write-Host ("  беру к разбору: " + $take.Count + " из " + $ids.Count)

  $tally = @{ bounce = 0; autoreply = 0; reply = 0; other = 0 }
  foreach ($id in $take) {
    $t = Imap-Send ("FETCH " + $id + " (BODY.PEEK[])")
    $fr = Imap-Read $t
    # IMAP отдаёт тело по кускам: заголовок отделён пустой строкой от текста,
    # склеиваем всё, что не является '*'/'tag' служебными строками
    $buf = @()
    foreach ($l in $fr) {
      if ($l -match ('^' + [regex]::Escape($t) + ' ') -or $l -match '^\*\s+\d+\s+(FETCH|FLAGS|OK) ' -or $l -match '^\* \d+ FETCH' -or $l -eq ')') { continue }
      $buf += $l
    }
    $msg = $buf -join "`r`n"
    $cls = Handle-Raw -Raw $msg -SourceName ('imap#' + $id)
    $tally[$cls.kind] = [int]$tally[$cls.kind] + 1

    # \Seen ставим ПОСЛЕ разбора и только на реальном (не DryRun) прогоне
    if (-not $LeaveUnseen -and -not $DryRun) {
      $t2 = Imap-Send ("STORE " + $id + " +FLAGS (\Seen)")
      $null = Imap-Read $t2
    }
  }

  Write-Host ''
  Write-Host '=== итог ===' -ForegroundColor Cyan
  Write-Host ("  отказов: {0}   автоответов: {1}   живых ответов: {2}   прочее: {3}" -f $tally.bounce, $tally.autoreply, $tally.reply, $tally.other)
  if ($tally.reply -gt 0) {
    Write-Host '  ЕСТЬ ЖИВЫЕ ОТВЕТЫ — их читает человек, не скрипт' -ForegroundColor Yellow
    $rp = Join-Path $root 'inbox-replies.csv'
    if (Test-Path $rp) { Write-Host ('  список: ' + $rp) }
  }
  if ($DryRun) { Write-Host '  DryRun: \Seen не проставлен, файлы не изменены' -ForegroundColor DarkYellow }
  $null = Imap-Send 'LOGOUT'
} finally {
  try { if ($ssl) { $ssl.Dispose() } } catch { }
  try { if ($tcp) { $tcp.Close() } } catch { }
}
exit 0
