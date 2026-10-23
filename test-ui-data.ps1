<#
  test-ui-data.ps1 — проверка данных, которые увидит человек в окне.

  Проверяем на боевых файлах и на битых, потому что окно открывается глазами,
  и если данные кривые, заметить это можно только по сломанной таблице.

    1. sent-log.csv читается, строки новые сверху
    2. старые строки без from помечены «(ящик не указан)», а не пустотой
    3. новые строки показывают реальный ящик
    4. статусы переведены: sent -> отправлено, failed -> ошибка, sent-mistake ->
       отдельная метка (письмо ушло, репутацию ящика оно уже съело)
    5. сводка по ящикам считает ТОЛЬКО отправленные, failed не в счёт
    6. двойная строка одной сделки (failed, потом sent) не ломает счёт
    7. inbox-replies.csv читается и переводит kind на русский
    8. отсутствующий inbox-replies.csv — пусто, не исключение
    9. файл без заголовка / битый CSV — пусто, не исключение
   10. пустая строка и строка без sent_at не попадают в таблицу
   11. Get-UiState собирает верный итог
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
. (Join-Path $root 'ui-data.ps1')

$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
$diagFile = Join-Path $root 'ui-data-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

$tmp = Join-Path $env:TEMP ('uidata-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

Write-Host '=== ui-data: данные для окна ==='

# --- боевой sent-log.csv ---
$log = Join-Path $root 'sent-log.csv'
$rows = @(Read-SentRows -SentLog $log)
Check 'боевой sent-log читается' ($rows.Count -gt 0) ('строк=' + $rows.Count)

$stamps = @($rows | ForEach-Object { $_.when })
$sorted = @($stamps | Sort-Object -Descending)
Check 'строки идут новые сверху' (($stamps -join '|') -eq ($sorted -join '|')) 'порядок не новый-сверху'

$withBox = @($rows | Where-Object { $_.box -ne '(ящик не указан)' })
$withoutBox = @($rows | Where-Object { $_.box -eq '(ящик не указан)' })
Check 'старые строки без from помечены, а не пусты' ($withoutBox.Count -gt 0) ('без пометки: ' + $withoutBox.Count)
# Факт про боевой файл: колонка from появилась после миграции схемы, поэтому
# ВСЕ старые отправки без ящика. Придумывать ящик нельзя, поэтому проверка на
# боевых данных обратная: ни одна строка не выдумывает адрес.
Check 'на боевых данных ящик не выдумывается' (@($rows | Where-Object { $_.box -like '*@*' }).Count -eq $withBox.Count) ('строк с адресом: ' + @($rows | Where-Object { $_.box -like '*@*' }).Count)

# а вот на файле с новыми отправками ящик обязан показываться
$newLog = Join-Path $tmp 'new.csv'
@(
  (@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach', 'from') -join ',')
  'i003,a@d.ru,A,s,2026-10-04 13:27:43,sent,,t.html,box1@domen.ru'
  'i004,b@d.ru,B,s,2026-10-04 13:40:00,sent,,t.html,box2@domen.ru'
) | Set-Content -Path $newLog -Encoding UTF8
$newRows = @(Read-SentRows -SentLog $newLog)
Check 'новые отправки показывают свой ящик' (@($newRows | Where-Object { $_.box -eq 'box1@domen.ru' }).Count -eq 1 -and @($newRows | Where-Object { $_.box -eq 'box2@domen.ru' }).Count -eq 1) (($newRows | ForEach-Object { $_.box }) -join ',')
Check 'сводка различает ящики' (@(Get-SentSummary -SentLog $newLog).Count -eq 2) ('групп=' + @(Get-SentSummary -SentLog $newLog).Count)
Check 'Get-UiState считает ящики' ((Get-UiState -SentLog $newLog).boxCount -eq 2) ('ящиков=' + (Get-UiState -SentLog $newLog).boxCount)

$st = @{}
foreach ($r in $rows) { $st[$r.status] = 1 }
$known = @('отправлено', 'отправлено по ошибке', 'ошибка', 'неизвестно')
$unknown = @($st.Keys | Where-Object { $known -notcontains $_ })
Check 'все статусы переведены на русский' ($unknown.Count -eq 0) ('не переведено: ' + ($unknown -join ', '))
Check 'нет статуса-массива в таблице' (@($rows | Where-Object { $_.status -is [array] }).Count -eq 0) 'статус пришёл массивом'

# перевод статусов проверяется на фикстуре, а не на боевом файле: живой лог
# меняется каждым прогоном, и через неделю в нём может не быть ни одного failed
$stLog = Join-Path $tmp 'statuses.csv'
@(
  (@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach', 'from') -join ',')
  'k1,a@d.ru,A,s,2026-10-04 10:00:00,sent,,t.html,b1@d.ru'
  'k2,b@d.ru,B,s,2026-10-04 10:01:00,failed,535 5.1.1,t.html,b1@d.ru'
  'k3,c@d.ru,C,s,2026-10-04 10:02:00,sent-mistake,пустое письмо,t.html,b1@d.ru'
) | Set-Content -Path $stLog -Encoding UTF8
$stRows = @(Read-SentRows -SentLog $stLog)
Check 'sent -> отправлено' (@($stRows | Where-Object { $_.status -eq 'отправлено' }).Count -eq 1) (($stRows | ForEach-Object { $_.status }) -join ',')
Check 'failed -> ошибка' (@($stRows | Where-Object { $_.status -eq 'ошибка' }).Count -eq 1) (($stRows | ForEach-Object { $_.status }) -join ',')
Check 'sent-mistake -> отдельная метка' (@($stRows | Where-Object { $_.status -eq 'отправлено по ошибке' }).Count -eq 1) (($stRows | ForEach-Object { $_.status }) -join ',')

# --- сводка по ящикам ---
$sum = @(Get-SentSummary -SentLog $log)
$noBoxRow = @($sum | Where-Object { $_.box -eq '(ящик не указан)' })
Check 'сводка считает отправленные, а не строки' (($sum | Measure-Object sent -Sum).Sum -le $rows.Count) 'сумма больше, чем строк'
if ($noBoxRow.Count -gt 0) {
  $failedInNoBox = @($rows | Where-Object { $_.box -eq '(ящик не указан)' -and $_.status -eq 'ошибка' }).Count
  Check 'в безымянной группе failed не учтён как отправка' ($noBoxRow[0].sent -eq ($withoutBox.Count - $failedInNoBox)) ("сводка=" + $noBoxRow[0].sent + " строк=" + $withoutBox.Count + " ошибок внутри=" + $failedInNoBox)
}

# --- двойная строка одной сделки ---
$dup = Join-Path $tmp 'dup.csv'
@(
  (@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach', 'from') -join ',')
  'i001,a@d.ru,A,s,2026-10-04 13:27:43,failed,535,t.html,b1@d.ru'
  'i001,a@d.ru,A,s,2026-10-04 13:34:00,sent,,t.html,b1@d.ru'
) | Set-Content -Path $dup -Encoding UTF8
$dupRows = @(Read-SentRows -SentLog $dup)
Check 'две строки одной сделки обе показаны' ($dupRows.Count -eq 2) ('строк=' + $dupRows.Count)
Check 'двойная строка не ломает счёт отправленных' ((Get-UiState -SentLog $dup).sentOk -eq 1) ('sentOk=' + (Get-UiState -SentLog $dup).sentOk)

# --- inbox-replies.csv ---
$inbox = Join-Path $tmp 'inbox.csv'
@(
  (@('seen_at', 'from', 'subject', 'kind', 'note') -join ',')
  '2026-10-04 14:00:00,director@buildco.ru,"Re: Сайт за 500",reply,ответ человека'
  '2026-10-04 14:05:00,hr@x.ru,out of office,autoreply,отложить'
) | Set-Content -Path $inbox -Encoding UTF8
$ib = @(Read-InboxRows -InboxFile $inbox)
Check 'входящие читаются' ($ib.Count -eq 2) ('строк=' + $ib.Count)
Check 'reply переведён на русский' (@($ib | Where-Object { $_.kind -eq 'ответ человека' }).Count -eq 1) (($ib | ForEach-Object { $_.kind }) -join ',')
Check 'autoreply переведён на русский' (@($ib | Where-Object { $_.kind -eq 'автоответ' }).Count -eq 1) (($ib | ForEach-Object { $_.kind }) -join ',')

# --- отсутствие файла ---
Check 'нет inbox-файла — пусто, не исключение' (@(Read-InboxRows -InboxFile (Join-Path $tmp 'net-takogo.csv')).Count -eq 0) 'не пусто'
Check 'нет sent-файла — пусто, не исключение' (@(Read-SentRows -SentLog (Join-Path $tmp 'net-takogo.csv')).Count -eq 0) 'не пусто'
Check 'пустая строка пути — пусто, не исключение' (@(Read-SentRows -SentLog '').Count -eq 0) 'не пусто'

# --- битый файл без шапки ---
$bad = Join-Path $tmp 'bad.csv'
'просто текст без запятой и без заголовка' | Set-Content -Path $bad -Encoding UTF8
Check 'файл без шапки не роняет чтение' (@(Read-SentRows -SentLog $bad).Count -eq 0) 'не пусто'

# --- мусорные строки ---
$dirty = Join-Path $tmp 'dirty.csv'
@(
  (@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach', 'from') -join ',')
  ''
  'dXXX,,Без даты,,,,,,'
  'd009,x@y.z,Норм,s,2026-10-04 10:00:00,sent,,,b1@d.ru'
) | Set-Content -Path $dirty -Encoding UTF8
$dRows = @(Read-SentRows -SentLog $dirty)
Check 'мусорные строки отброшены' ($dRows.Count -eq 1 -and $dRows[0].deal -eq 'd009') ('строк=' + $dRows.Count)

# --- итог ---
$state = Get-UiState -SentLog $log -InboxFile $inbox
Check 'итог собран: отправлено/ошибки/ответы' ($state.sentOk -gt 0 -and $state.replies -eq 1 -and $state.inboxExists) ("sentOk=" + $state.sentOk + " replies=" + $state.replies)
Check 'пустой inbox без файла отмечен в состоянии' ((Get-UiState -SentLog $log -InboxFile (Join-Path $tmp 'net-takogo.csv')).inboxExists -eq $false) 'отмечен как существующий'

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -gt 0) {
  $fails -join "`r`n" | Set-Content -Path $diagFile -Encoding UTF8
  Write-Host ("FAIL {0} / PASS {1}  (подробности: {2})" -f $fail, $pass, $diagFile)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
