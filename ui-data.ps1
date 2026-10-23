<#
  ui-data.ps1 — слой данных для desktop-приложения. Без интерфейса.

  Зачем отдельно от окна. Главный вопрос интерфейса — «какой мой ящик кому
  что отправил» — это вопрос к данным, а не к вёрстке. Если логика живёт в
  обработчике кнопки, её нечем проверить: окно нужно открывать глазами, а
  проверить надо то, что человек реально увидит. Здесь чистые функции, которые
  читают CSV и отдают готовые строки, а test-ui-data.ps1 проверяет их на
  боевых и битых файлах.

  Три факта о данных, которые ломают наивную реализацию:
    1. колонка `from` в sent-log.csv появилась не сразу: у старых отправок
       она пустая. Пустую ячейку нельзя молча показывать как пробел — человек
       решит, что письмо ушло неизвестно откуда.
    2. отправка одной сделки может дать две строки: сначала failed, потом sent.
       Обе нужны, но «сколько писем ушло» считается только по sent.
    3. inbox-replies.csv может не существовать (ещё не было живых ответов) или
       быть без заголовка. Отсутствие файла — это не ошибка приложения, а
       нормальное состояние, и пустой экран тут правильный ответ.
#>

# Сводка по ящикам для верхней полосы: сколько писем ушло с каждого ящика.
function Get-SentSummary {
  param([string]$SentLog = '')
  $sum = [ordered]@{}
  foreach ($r in @(Read-SentRows -SentLog $SentLog)) {
    $key = $r.box
    if (-not $sum.Contains($key)) { $sum[$key] = 0 }
    $sum[$key] = [int]$sum[$key] + 1
  }
  $out = New-Object System.Collections.ArrayList
  foreach ($k in $sum.Keys) {
    [void]$out.Add([pscustomobject]@{ box = $k; sent = $sum[$k] })
  }
  return @($out)
}

# Строки «отправленные» в виде, готовом для таблицы.
function Read-SentRows {
  param([string]$SentLog = '')
  $rows = New-Object System.Collections.ArrayList
  if ($SentLog -and -not (Test-Path $SentLog)) { return @() }
  if (-not $SentLog) { return @() }
  $raw = @()
  try { $raw = @(Import-Csv -Path $SentLog -Encoding UTF8) } catch { return @() }
  foreach ($r in $raw) {
    if (-not $r.sent_at) { continue }
    # старые строки без from: показываем честную пометку, а не пустоту
    $box = ($r.from + '').Trim()
    if (-not $box) { $box = '(ящик не указан)' }
    $status = ($r.status + '').Trim()
    # if/elseif, а не switch: в switch без break ветка '^sent' срабатывает и на
    # 'sent-mistake' тоже, и статус приходил массивом из двух строк — в таблице
    # это выглядело как «отправлено,System.Object[]»
    if ($status -match '^sent-mistake') { $statusRu = 'отправлено по ошибке' }
    elseif ($status -match '^sent') { $statusRu = 'отправлено' }
    elseif ($status -match '^failed') { $statusRu = 'ошибка' }
    elseif ($status) { $statusRu = $status }
    else { $statusRu = 'неизвестно' }
    $when = ($r.sent_at + '').Trim()
    [void]$rows.Add([pscustomobject]@{
        when = $when
        box = $box
        to = ($r.to + '').Trim()
        company = ($r.company + '').Trim()
        subject = ($r.subject + '').Trim()
        status = $statusRu
        deal = ($r.id + '').Trim()
        attach = ($r.attach + '').Trim()
      })
  }
  # новые сверху: смотреть надо на последнее, а не на первое
  $out = @($rows) | Sort-Object -Property when -Descending
  return @($out)
}

# Строки «полученные» в виде, готовом для таблицы.
function Read-InboxRows {
  param([string]$InboxFile = '')
  $rows = New-Object System.Collections.ArrayList
  if (-not $InboxFile) { return @() }
  if (-not (Test-Path $InboxFile)) { return @() }
  $raw = @()
  try { $raw = @(Import-Csv -Path $InboxFile -Encoding UTF8) } catch { return @() }
  foreach ($r in $raw) {
    if (-not $r.seen_at) { continue }
    $kind = ($r.kind + '').Trim()
    $kindRu = switch ($kind) {
      'reply' { 'ответ человека' }
      'autoreply' { 'автоответ' }
      'bounce' { 'отказ доставки' }
      'own' { 'наше письмо' }
      default { if ($kind) { $kind } else { 'письмо' } }
    }
    [void]$rows.Add([pscustomobject]@{
        when = ($r.seen_at + '').Trim()
        from = ($r.from + '').Trim()
        subject = ($r.subject + '').Trim()
        kind = $kindRu
        note = ($r.note + '').Trim()
      })
  }
  $out = @($rows) | Sort-Object -Property when -Descending
  return @($out)
}

# Итог для строки состояния: сколько ушло, сколько ошибок, есть ли ответы.
function Get-UiState {
  param([string]$SentLog = '', [string]$InboxFile = '')
  $sent = @(Read-SentRows -SentLog $SentLog)
  $inbox = @(Read-InboxRows -InboxFile $InboxFile)
  $sentOk = @($sent | Where-Object { $_.status -eq 'отправлено' -or $_.status -eq 'отправлено по ошибке' }).Count
  $sentErr = @($sent | Where-Object { $_.status -eq 'ошибка' }).Count
  $boxes = @(Get-SentSummary -SentLog $SentLog)
  $boxCount = @($boxes | Where-Object { $_.box -ne '(ящик не указан)' }).Count
  $replies = @($inbox | Where-Object { $_.kind -eq 'ответ человека' }).Count
  return [pscustomobject]@{
    sent = $sent
    inbox = $inbox
    boxes = $boxes
    sentOk = $sentOk
    sentErr = $sentErr
    boxCount = $boxCount
    replies = $replies
    inboxExists = [bool]($InboxFile -and (Test-Path $InboxFile))
    inboxPath = if ($InboxFile) { $InboxFile } else { '' }
  }
}
