<#
  pipeline.ps1 — трекер сделок от «нашёл компанию без сайта» до «получил деньги»

  Смысл: алгоритм продажи网站 держится на гейтах. Нельзя перейти на следующий
  этап, пока не выполнено условие текущего. Иначе основная утечка денег —
  потратить 20 часов на макет и сайт клиенту, который уже исчез.

  Этапы (A — квалификация лида, B — деньги):
    A1 проверка лида      в базе, домен проверен, сайта нет
    A2 письмо отправлено  одиночное, персонализированное
    A3 follow-up 1        +4 дня
    A4 follow-up 2        +11 дней
    A5 закрыто в ноль     +18 дней, ответ «стоп» или тишина
    B1 разговор           ответили / дозвонились, заданы 3 вопроса
    B2 КП отправлено      смета и цена в письме, срок ответа 48 ч
    B3 показ макетов      звонок/встреча, показ 3 вариантов
    B4 договор+предоплата подписан, оплачено >= 50%
    B5 сборка             домен и хостинг на клиента, доступы его
    B6 передача           сайт открыт, домен на его имя, инструкция
    B7 финальная оплата   оплачено 100%, гарантия запущена
    B8 допродажа          чек через 30 дней

  Команды:
    pipeline.ps1 init
    pipeline.ps1 add -Top 30 -MinScore 20
    pipeline.ps1 stage -Id d001 -To b4 -Value 35000 -Prepay 17500
    pipeline.ps1 bounce -Id d001 -Next "550 5.1.1 User unknown" -Note "ящик не существует"
    pipeline.ps1 list
    pipeline.ps1 list -Stage a2
    pipeline.ps1 due
    pipeline.ps1 stats
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('init', 'add', 'stage', 'bounce', 'list', 'due', 'stats')][string]$Cmd = 'list',
  [string]$File = 'deals.csv',
  [string]$Source = 'noweb-leads-verified.csv',
  [int]$Top = 0,
  [int]$MinScore = 0,
  [string]$Id = '',
  [string]$To = '',
  [int]$Value = 0,
  [int]$Prepay = 0,
  [int]$Paid = 0,
  [string]$Stage = '',
  [string]$DeadFile = '',
  [string]$Next = '',
  [string]$Note = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$db = if ([IO.Path]::IsPathRooted($File)) { $File } else { Join-Path $root $File }

# порядок этапов важен: gates проверяются по позиции
$stages = [ordered]@{
  a1 = 'проверка лида'
  a2 = 'письмо отправлено'
  a3 = 'follow-up 1'
  a4 = 'follow-up 2'
  a5 = 'закрыто в ноль'
  b1 = 'разговор'
  b2 = 'КП отправлено'
  b3 = 'показ макетов'
  b4 = 'договор+предоплата'
  b5 = 'сборка'
  b6 = 'передача'
  b7 = 'финальная оплата'
  b8 = 'допродажа'
  z1 = 'адрес не существует'
}

$cols = @('id', 'stage', 'stage_entered', 'next_action_date', 'next_action', 'company', 'inn', 'city',
  'okved', 'score', 'email', 'phone', 'source_url', 'value_rub', 'prepay_rub', 'paid_rub',
  'sent_date', 'reply_date', 'notes')

function Save-Deals($rows) {
  $list = @($rows)
  if ($list.Count -eq 0) {
    # a header-only file: Import-Csv on an empty file fails on the next run
    Set-Content -Path $db -Value ($cols -join ',') -Encoding UTF8
    return
  }
  $list | Export-Csv -Path $db -NoTypeInformation -Encoding UTF8
}
function Load-Deals {
  if (-not (Test-Path $db)) { return @() }
  $rows = @(Import-Csv $db)
  if ($rows.Count -eq 1 -and $rows[0].PSObject.Properties.Count -eq 0) { return @() }
  return $rows
}
function Pos([string]$s) {
  $i = 0
  foreach ($k in $stages.Keys) { if ($k -eq $s) { return $i }; $i++ }
  return -1
}
function New-Id([int]$n) { return ('d{0:d3}' -f $n) }

function Test-Gate($d, [string]$to) {
  # возвращает список нарушений (пустой = можно переходить)
  $bad = @()
  $from = $d.stage
  # z1 ставится по факту отказа SMTP — из любого этапа, это не продвижение,
  # а остановка. Проверка «назад или тот же этап» её не применяет.
  if ($to -ne 'z1' -and (Pos $to) -le (Pos $from)) { $bad += "переход назад или в тот же этап ($from -> $to) не считается продвижением" }
  switch ($to) {
    'z1' { if (-not $d.email) { $bad += 'не указан адрес, который отказал' } }
    'b2' { if ([int]$d.score -lt 10) { $bad += 'слишком низкий score лида, сначала перепроверить приоритет' } }
    'b3' { if (-not $d.email -and -not $d.phone) { $bad += 'нет ни почты, ни телефона — нечем показывать макеты' } }
    'b4' {
      if ([int]$d.value_rub -le 0) { $bad += 'не указана сумма сделки (нужен -Value)' }
      if ([int]$d.prepay_rub -lt [Math]::Ceiling([int]$d.value_rub * 0.5)) { $bad += 'предоплата меньше 50% — макет и сайт без неё не делаем' }
    }
    'b5' { if ([int]$d.prepay_rub -lt [Math]::Ceiling([int]$d.value_rub * 0.5)) { $bad += 'не оплачена предоплата, сборка не начинается' } }
    'b7' {
      if ([int]$d.paid_rub -lt [int]$d.value_rub) { $bad += 'оплачено меньше суммы сделки — финальный этап не закрываем' }
      if (-not $d.next_action_date) { $bad += 'не назначена дата чек-ина через 30 дней' }
    }
  }
  return $bad
}

switch ($Cmd) {
  'init' {
    Save-Deals @()
    Write-Host "created $db with columns: $($cols -join ', ')"
  }

  'add' {
    $src = Join-Path $root $Source
    if (-not (Test-Path $src)) { throw "no source: $src" }
    $leads = @(Import-Csv $src)
    if ($MinScore -gt 0) { $leads = @($leads | Where-Object { [int]$_.score -ge $MinScore }) }
    $leads = @($leads | Sort-Object -Property @{ Expression = { [int]$_.score }; Descending = $true })
    if ($Top -gt 0 -and $leads.Count -gt $Top) { $leads = $leads[0..($Top - 1)] }

    $deals = New-Object System.Collections.ArrayList
    foreach ($x in (Load-Deals)) { [void]$deals.Add($x) }
    $have = @{}
    foreach ($d in $deals) {
      $k = if ($d.inn) { 'i' + $d.inn } elseif ($d.source_url) { 'u' + $d.source_url } else { 'n' + $d.company }
      $have[$k] = $true
    }
    $added = 0
    foreach ($l in $leads) {
      $key = if ($l.inn) { 'i' + $l.inn } elseif ($l.url) { 'u' + $l.url } else { 'n' + $l.company }
      if ($have.ContainsKey($key)) { continue }
      $n = $deals.Count + 1
      $mail = ''
      if ($l.email_best) { $mail = ($l.email_best -split '\|')[0].Trim() }
      elseif ($l.email_free) { $mail = ($l.email_free -split '\|')[0].Trim() }
      $d = [pscustomobject]@{
        id = (New-Id $n)
        stage = 'a1'
        stage_entered = (Get-Date -Format 'yyyy-MM-dd')
        next_action_date = (Get-Date -Format 'yyyy-MM-dd')
        next_action = 'отправить письмо из outbox (1 получатель, без вложений)'
        company = $l.name
        inn = $l.inn
        city = $l.city
        okved = $l.okved
        score = $l.score
        email = $mail
        phone = (($l.phone -split '\|')[0]).Trim()
        source_url = $l.url
        value_rub = 0
        prepay_rub = 0
        paid_rub = 0
        sent_date = ''
        reply_date = ''
        notes = ''
      }
      [void]$deals.Add($d)
      $have[$key] = $true
      $added++
    }
    Save-Deals $deals.ToArray()
    Write-Host "added $added deals, total $($deals.Count) -> $db"
  }

  'stage' {
    $deals = Load-Deals
    if (-not $Id) { throw 'нужен -Id (например d001)' }
    $idx = -1
    for ($i = 0; $i -lt $deals.Count; $i++) { if ($deals[$i].id -eq $Id) { $idx = $i } }
    if ($idx -lt 0) { throw "нет сделки $Id" }
    $d = $deals[$idx]
    $target = $To
    if (-not $target) { throw 'нужен -To (этап)' }
    if (-not $stages.Contains($target)) { throw "неизвестный этап: $target. Доступно: $($stages.Keys -join ', ')" }

    if ([int]$Value -gt 0) { $d.value_rub = $Value }
    if ([int]$Prepay -gt 0) { $d.prepay_rub = $Prepay }
    if ([int]$Paid -gt 0) { $d.paid_rub = $Paid }
    if ($Note) { $d.notes = (($d.notes, $Note) | Where-Object { $_ }) -join '; ' }

    $bad = Test-Gate $d $target
    if ($bad.Count -gt 0) {
      Write-Host "ПЕРЕХОД ЗАБЛОКИРОВАН ($($d.stage) -> $target):" -ForegroundColor Red
      $bad | ForEach-Object { Write-Host "  - $_" }
      exit 2
    }

    $d.stage = $target
    $d.stage_entered = (Get-Date -Format 'yyyy-MM-dd')
    if ($target -eq 'a2' -and -not $d.sent_date) { $d.sent_date = (Get-Date -Format 'yyyy-MM-dd'); $d.next_action_date = (Get-Date).AddDays(4).ToString('yyyy-MM-dd'); $d.next_action = 'follow-up 1 (письмо followup-1.txt)' }
    elseif ($target -eq 'a3') { $d.next_action_date = (Get-Date).AddDays(7).ToString('yyyy-MM-dd'); $d.next_action = 'follow-up 2 (письмо followup-2.txt)' }
    elseif ($target -eq 'a4') { $d.next_action_date = (Get-Date).AddDays(7).ToString('yyyy-MM-dd'); $d.next_action = 'break-up (письмо breakup.txt), иначе закрыть в ноль' }
    elseif ($target -eq 'a5') { $d.next_action_date = ''; $d.next_action = '' }
    elseif ($target -eq 'b1') { $d.reply_date = (Get-Date -Format 'yyyy-MM-dd'); $d.next_action_date = (Get-Date).AddDays(1).ToString('yyyy-MM-dd'); $d.next_action = 'задать 3 вопроса и в тот же день отправить КП' }
    elseif ($target -eq 'b2') { $d.next_action_date = (Get-Date).AddDays(2).ToString('yyyy-MM-dd'); $d.next_action = 'позвонить, показать макеты, выставить счёт на предоплату' }
    elseif ($target -eq 'b3') { $d.next_action_date = (Get-Date).AddDays(3).ToString('yyyy-MM-dd'); $d.next_action = 'договор + счёт на 50% предоплаты' }
    elseif ($target -eq 'b4') { $d.next_action_date = (Get-Date).AddDays(7).ToString('yyyy-MM-dd'); $d.next_action = 'собрать сайт (5-7 дней), доступы клиента' }
    elseif ($target -eq 'b5') { $d.next_action_date = (Get-Date).AddDays(7).ToString('yyyy-MM-dd'); $d.next_action = 'передать сайт, перевести домен на клиента, видеоинструкция' }
    elseif ($target -eq 'b6') { if (-not $Next) { $Next = 'чек-ин через 30 дней' }; $d.next_action_date = (Get-Date).AddDays(30).ToString('yyyy-MM-dd'); $d.next_action = $Next }
    elseif ($target -eq 'b7') { $d.next_action_date = (Get-Date).AddDays(30).ToString('yyyy-MM-dd'); $d.next_action = $Next }
    elseif ($target -eq 'b8') { $d.next_action_date = ''; $d.next_action = '' }
    elseif ($target -eq 'z1') { $d.next_action_date = ''; $d.next_action = '' }

    if ($Next) { $d.next_action = $Next }
    $deals[$idx] = $d
    Save-Deals $deals
    $money = ''
    if ([int]$d.paid_rub -gt 0) { $money = "  деньги: {0} / {1} ₽" -f $d.paid_rub, $d.value_rub }
    Write-Host ("{0} -> {1} ({2}){3}" -f $Id, $target, $stages[$target], $money)
    Write-Host ("   следующее действие: {0} — {1}" -f $d.next_action_date, $d.next_action)
  }

  'bounce' {
    # Отказ доставки — самый ценный сигнал, который вообще бывает в холодной
    # рассылке: почтовый сервер САМ сказал, что ящика нет. Домен при этом может
    # существовать и принимать почту, поэтому проверка домена такое не видит.
    if (-not $Id) { throw 'нужен -Id' }
    $deals = Load-Deals
    $idx = -1
    for ($i = 0; $i -lt $deals.Count; $i++) { if ($deals[$i].id -eq $Id) { $idx = $i } }
    if ($idx -lt 0) { throw "нет сделки $Id" }
    $d = $deals[$idx]
    # путь мёртвых адресов ЯВНО задаётся параметром: иначе тест на временной
    # доске писал бы в боевой dead-addresses.csv (проверено — так и случилось)
    $dead = if ($DeadFile) { if ([IO.Path]::IsPathRooted($DeadFile)) { $DeadFile } else { Join-Path $root $DeadFile } }
            else { Join-Path $root 'dead-addresses.csv' }
    # Один адрес — одна строка в dead-addresses.csv. Повторный bounce того же
    # ящика (а он будет: автопрогон шлёт follow-up тем, кто уже терминирован)
    # обновлял метку времени, и файл разрастался дублями: 24mpe@mail.ru
    # оказался записан дважды, "всего там: 3" при двух мёртвых адресах.
    $existing = @()
    if (Test-Path $dead) { $existing = @(Import-Csv -Path $dead -Encoding UTF8) }
    $dupe = $existing | Where-Object { $_.email -and ($_.email.ToLower() -eq ($d.email + '').ToLower()) } | Select-Object -First 1
    if ($dupe) {
      Write-Host ("{0} уже есть в dead-addresses.csv, обновляю метку времени" -f $d.email) -ForegroundColor DarkYellow
      $dupe.bounced_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
      if ($Next) { $dupe.smtp = $Next }
      $existing = @($existing | ForEach-Object { if ($_ -eq $dupe) { $dupe } else { $_ } })
      $existing | Export-Csv -Path $dead -NoTypeInformation -Encoding UTF8
    } else {
      $rec = [pscustomobject]@{
        email = $d.email; id = $Id; company = $d.company; inn = $d.inn
        smtp = $Next; bounced_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); sent_at = $d.sent_date
      }
      $rec | Export-Csv -Path $dead -NoTypeInformation -Encoding UTF8 -Append
    }
    $d.stage = 'z1'
    $d.stage_entered = (Get-Date -Format 'yyyy-MM-dd')
    $d.next_action_date = ''
    $d.next_action = ''
    if ($Note) { $d.notes = (($d.notes, $Note) | Where-Object { $_ }) -join '; ' }
    $deals[$idx] = $d
    Save-Deals $deals
    $bad = 1
    $rec2 = $deals[$idx]
    Write-Host ("{0} -> z1 (адрес не существует)" -f $Id) -ForegroundColor Red
    Write-Host ("   мёртвый адрес: {0}   ответ SMTP: {1}" -f $rec2.email, $Next)
    Write-Host ("   записан в dead-addresses.csv, всего там: {0}" -f @(Import-Csv $dead).Count) -ForegroundColor Yellow
  }

  'list' {
    $deals = Load-Deals
    if ($deals.Count -eq 0) { Write-Host 'сделок нет. Создай: pipeline.ps1 init, затем pipeline.ps1 add'; break }
    if ($Stage) { $deals = @($deals | Where-Object { $_.stage -eq $Stage }) }
    $lines = @()
    foreach ($d in $deals) {
      $lines += ('{0,-5} {1,-3} {2,-20} {3,-28} score={4,-3} {5}' -f $d.id, $d.stage, $stages[$d.stage], $d.company, $d.score, $(if ($d.email) { $d.email } else { $d.phone }))
    }
    $lines | ForEach-Object { Write-Host $_ }
    Write-Host ''
    Write-Host "всего: $($deals.Count)"
  }

  'due' {
    $deals = Load-Deals
    $today = Get-Date -Format 'yyyy-MM-dd'
    $due = @($deals | Where-Object { $_.next_action_date -and $_.next_action_date -le $today -and $_.stage -ne 'a5' -and $_.stage -ne 'b8' })
    if ($due.Count -eq 0) { Write-Host "на сегодня ($today) задач нет"; break }
    Write-Host "просрочено / на сегодня ($today): $($due.Count)" -ForegroundColor Yellow
    foreach ($d in $due) {
      Write-Host ('{0,-5} {1,-3} {2,-28} просрочка с {3}' -f $d.id, $d.stage, $d.company, $d.next_action_date)
      Write-Host ('      что делать: {0}' -f $d.next_action)
    }
  }

  'stats' {
    $deals = Load-Deals
    if ($deals.Count -eq 0) { Write-Host 'сделок нет'; break }
    Write-Host "=== воронка ($($deals.Count) сделок) ==="
    foreach ($k in $stages.Keys) {
      $c = @($deals | Where-Object { $_.stage -eq $k }).Count
      $bar = '#' * $c
      Write-Host ('{0,-3} {1,-20} {2,4}  {3}' -f $k, $stages[$k], $c, $bar)
    }
    $val = 0; $paid = 0
    foreach ($d in $deals) { $val += [int]$d.value_rub; $paid += [int]$d.paid_rub }
    $won = @($deals | Where-Object { [int]$d.paid_rub -ge [int]$d.value_rub -and [int]$d.value_rub -gt 0 }).Count
    $open = @($deals | Where-Object { [int]$d.value_rub -gt 0 -and [int]$d.paid_rub -lt [int]$d.value_rub }).Count
    Write-Host ''
    Write-Host ("в работе суммой: {0} ₽" -f $val)
    Write-Host ("получено денег: {0} ₽" -f $paid)
    Write-Host ("сделок закрыто полностью: {0}, в работе: {1}" -f $won, $open)
  }
}
