<#
  test-ui-app.ps1 — проверка окна БЕЗ его показа.

  Зачем проверять окно скриптом. Глазами можно увидеть «открылось/не открылось»,
  но нельзя увидеть, что в таблице лежат все 18 писем, что вторая вкладка
  называется «Полученные», что при пустом входящем видна правильная надпись и
  что колонки в шапке и в строках совпадают по ширине. Окно собирается в STA,
  структура сверяется с данными, и окно закрывается без показа. Ни одного окна
  на экране.

  Что проверяем:
    1. окно собирается в STA (XAML грузится, имена элементов находятся)
    2. две вкладки, в заголовках количество строк
    3. в шапке 6 колонок и русские заголовки в правильном порядке
    4. шапка и шаблон строки объявляют ОДИНАКОВЫЕ ширины колонок — иначе
       заголовки разъедутся по значениям, и глазом это замечается сразу
    5. строки в таблице равны данным из sent-log.csv, новые сверху
    6. у каждой строки есть ящик или честная пометка
    7. при пустом входящем надпись видна, при непустом скрыта
    8. в XAML есть тёмный ScrollBar и правило приглушения строк без ящика —
       без них окно светлеет пятнами (так и выглядела первая версия)
    9. повторное обновление не падает
   10. в MTA приложение объясняет, как запускать, и выходит с кодом 3

  Тест сам себя перезапускает с -STA: WPF без STA не работает, а запускать
  тест руками с правильным ключом нельзя — забудут.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
  if ($env:UIAPP_TEST_RELAUNCHED) {
    Write-Host 'STA не получен даже после перезапуска' -ForegroundColor Red
    exit 1
  }
  $env:UIAPP_TEST_RELAUNCHED = '1'
  Write-Host 'перезапускаю себя в STA (WPF без него не работает)...'
  & powershell -NoProfile -STA -ExecutionPolicy Bypass -File $PSCommandPath
  exit $LASTEXITCODE
}

$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
$diagFile = Join-Path $root 'ui-app-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

Write-Host '=== ui-app: окно собирается и наполняется ==='

$sentLog = Join-Path $root 'sent-log.csv'
$inboxTmp = Join-Path $env:TEMP ('uibox-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
@(
  (@('seen_at', 'from', 'subject', 'kind', 'note') -join ',')
  '2026-10-04 14:00:00,director@buildco.ru,"Re: Сайт за 500",reply,ответ человека'
) | Set-Content -Path $inboxTmp -Encoding UTF8

$ErrorActionPreference = 'Stop'
$win = $null
try {
  . (Join-Path $root 'ui-app.ps1') -SentLog $sentLog -InboxFile $inboxTmp -NoAutoRefresh -BuildOnly
  $win = $win
} catch {
  Check 'окно собирается' $false ($_.Exception.Message + ' / строка ' + $_.InvocationInfo.ScriptLineNumber)
} finally { $ErrorActionPreference = 'Continue' }

# $win после dot-source — это окно из ui-app.ps1
if ($win) {
  Check 'окно собирается' $true ''

  $sentList = $win.FindName('sentList')
  $inboxList = $win.FindName('inboxList')
  $sentEmpty = $win.FindName('sentEmpty')
  $inboxEmpty = $win.FindName('inboxEmpty')
  $sumTb = $win.FindName('sumTb')
  $tabSentBtn = $win.FindName('tabSentBtn')
  $tabInboxBtn = $win.FindName('tabInboxBtn')
  $sentRoot = $win.FindName('sentRoot')
  $inboxRoot = $win.FindName('inboxRoot')
  Check 'именованные элементы найдены' ($null -ne $sentList -and $null -ne $inboxList -and $null -ne $tabSentBtn -and $null -ne $inboxRoot) 'FindName вернул пусто'

  # --- вкладки: две кнопки и две панели, без TabControl ---
  Check 'две кнопки-вкладки' (($null -ne $tabSentBtn) -and ($null -ne $tabInboxBtn)) 'нет кнопок вкладок'
  Check 'две панели содержимого' (($null -ne $sentRoot) -and ($null -ne $inboxRoot)) 'нет панелей'
  $h1 = [string]$tabSentBtn.Content; $h2 = [string]$tabInboxBtn.Content
  Check 'название первой вкладки со счётчиком' ($h1 -match '^Отправленные · \d+$') $h1
  Check 'название второй вкладки со счётчиком' ($h2 -match '^Полученные · \d+$') $h2
  Check 'активна первая вкладка' ($sentRoot.Visibility -eq [System.Windows.Visibility]::Visible -and $inboxRoot.Visibility -eq [System.Windows.Visibility]::Collapsed) ("sent=" + $sentRoot.Visibility + " inbox=" + $inboxRoot.Visibility)
  Show-Tab 'inbox'
  Check 'переключение на «Полученные» работает' ($inboxRoot.Visibility -eq [System.Windows.Visibility]::Visible -and $sentRoot.Visibility -eq [System.Windows.Visibility]::Collapsed) ("sent=" + $sentRoot.Visibility + " inbox=" + $inboxRoot.Visibility)
  Show-Tab 'sent'
  Check 'переключение обратно работает' ($sentRoot.Visibility -eq [System.Windows.Visibility]::Visible) ("sent=" + $sentRoot.Visibility)

  # --- шапка колонок ---
  $headGrid = $sentRoot.Children | Where-Object { $_ -is [System.Windows.Controls.Grid] } | Select-Object -First 1
  $titles = @()
  if ($headGrid) {
    foreach ($c in $headGrid.Children) { if ($c -is [System.Windows.Controls.TextBlock]) { $titles += [string]$c.Text } }
  }
  Check 'в шапке 6 колонок' ($headGrid -and $headGrid.ColumnDefinitions.Count -eq 6) ('колонок=' + $(if ($headGrid) { $headGrid.ColumnDefinitions.Count } else { 'нет шапки' }))
  Check 'заголовки колонок в правильном порядке' (($titles -join ',') -eq 'КОГДА,ЯЩИК,КОМУ,КОМПАНИЯ,ТЕМА,СТАТУС') ($titles -join ',')
  Check 'колонка «ЯЩИК» вторая' ($titles[1] -eq 'ЯЩИК') $titles[1]

  # --- ширины колонок шапки и шаблона строки должны совпадать ---
  $xamlText = [IO.File]::ReadAllText((Join-Path $root 'ui-app.xaml'), [Text.Encoding]::UTF8)
  $grids = [regex]::Matches($xamlText, '(?s)<Grid[^>]*>\s*<Grid\.ColumnDefinitions>(.*?)</Grid\.ColumnDefinitions>')
  $widthSets = @()
  foreach ($m in $grids) {
    $w = @([regex]::Matches($m.Groups[1].Value, 'Width="([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
    if ($w.Count -eq 6 -or $w.Count -eq 5) { $widthSets += ,($w -join ',') }
  }
  $six = @($widthSets | Where-Object { ($_ -split ',').Count -eq 6 })
  Check 'две таблицы с 6 колонками в разметке' ($six.Count -eq 2) ('нашёл: ' + $six.Count)
  Check 'ширины колонок в шапке и строке совпадают' ($six.Count -eq 2 -and $six[0] -eq $six[1]) ('шапка=' + $(if ($six.Count) { $six[0] } else { '-' }) + ' строка=' + $(if ($six.Count -gt 1) { $six[1] } else { '-' }))
  $five = @($widthSets | Where-Object { ($_ -split ',').Count -eq 5 })
  Check 'входящая таблица имеет 5 колонок в шапке и строке' ($five.Count -eq 2 -and $five[0] -eq $five[1]) ('нашёл: ' + $five.Count)

  # --- правила темы, без которых окно светлеет ---
  Check 'тёмная полоса прокрутки задана в разметке' ($xamlText -match '(?s)<Style TargetType="ScrollBar">') 'нет стиля ScrollBar'
  Check 'кнопка-вкладка стилизована' ($xamlText -match 'x:Key="TabBtn"') 'нет стиля TabBtn'
  Check 'системный TabControl не используется' (-not ($xamlText -match '<TabControl')) 'TabControl остался в разметке'
  Check 'строка таблицы переопределена' ($xamlText -match '(?s)<Style TargetType="ListBoxItem">') 'нет стиля ListBoxItem'
  Check 'приглушение строк без ящика задано' (($xamlText -match '\(ящик не указан\)') -and ($xamlText -match '<DataTrigger Binding="\{Binding box\}"')) 'нет правила приглушения'

  # --- данные ---
  $rows = @($sentList.ItemsSource)
  $data = @(Get-UiState -SentLog $sentLog -InboxFile $inboxTmp)
  Check 'строки в таблице равны данным' ($rows.Count -eq $data.sent.Count) ('таблица=' + $rows.Count + ' данные=' + $data.sent.Count)
  Check 'строки идут новые сверху' ($rows[0].when -eq $data.sent[0].when) ('первая=' + $rows[0].when)
  Check 'в каждой строке ящик или честная пометка' (@($rows | Where-Object { -not $_.box }).Count -eq 0) 'есть строка без ящика'
  Check 'входящих строк 1' (@($inboxList.ItemsSource).Count -eq 1) ('строк=' + @($inboxList.ItemsSource).Count)
  Check 'при непустом входящем надпись скрыта' ($inboxEmpty.Visibility -eq [System.Windows.Visibility]::Collapsed) ([string]$inboxEmpty.Visibility)

  # --- сводка ---
  $sumTxt = [string]$sumTb.Text
  Check 'сводка содержит счётчики' (($sumTxt -match 'отправлено') -and ($sumTxt -match 'ошибок') -and ($sumTxt -match 'ответов')) $sumTxt

  # --- пустое входящее: подменяем путь в состоянии и обновляем ---
  $script:uiState.inboxFile = (Join-Path $env:TEMP 'net-takogo-inbox.csv')
  $null = Update-Ui
  Check 'при пустом входящем надпись видна' ($inboxEmpty.Visibility -eq [System.Windows.Visibility]::Visible) ([string]$inboxEmpty.Visibility)
  Check 'вкладка «Полученные» показывает ноль' ([string]$tabInboxBtn.Content -eq 'Полученные · 0') ([string]$tabInboxBtn.Content)
  Check 'список входящих пуст' (@($inboxList.ItemsSource).Count -eq 0) 'строки остались'
  $script:uiState.inboxFile = $inboxTmp
  $null = Update-Ui

  # --- шаблон строки реально применяется? ---
  # Measure + UpdateLayout заставляют ListBox создать контейнеры строк и применить
  # шаблон. Без этого шаблон остаётся «непрочитанным», и ошибка разметки внутри
  # DataTemplate всплывает только в открытом окне: так вышло с двойным Style на
  # TextBlock (XAML грузился, -BuildOnly проходил, а окно падало на ShowDialog).
  $tplErr = ''
  try {
    $sentList.ItemsSource = $rows
    $null = $sentList.Measure((New-Object System.Windows.Size(1200, 500)))
    $sentList.UpdateLayout()
    $inboxList.ItemsSource = @($inboxList.ItemsSource)
    $null = $inboxList.Measure((New-Object System.Windows.Size(1200, 500)))
    $inboxList.UpdateLayout()
  } catch { $tplErr = $_.Exception.Message }
  Check 'шаблон строки применяется без ошибок' (-not $tplErr) $tplErr
  # --- повторное обновление ---
  $threw = ''
  try { $null = Update-Ui; $null = $sentList.ItemsSource.Count } catch { $threw = $_.Exception.Message }
  Check 'повторное обновление не падает' (-not $threw) $threw

  try { $win.Close() } catch { }
}

# --- в MTA приложение объясняет, что делать ---
# Просто опустить -STA нельзя: powershell.exe начиная с версии 3 сам стартует в
# STA, поэтому «сломанный» случай воспроизводится только через явный MTA.
$rs = [RunspaceFactory]::CreateRunspace()
$rs.ApartmentState = 'MTA'
$rs.ThreadOptions = 'ReuseThread'
$rs.Open()
$ps = [PowerShell]::Create()
$ps.Runspace = $rs
# Вызываем файлом, а не текстом: у AddScript нет $PSScriptRoot, и скрипт упал бы
# на Join-Path $PSScriptRoot, не дойдя до проверки STA. Ошибка была бы ложной.
$uiPath = (Join-Path $root 'ui-app.ps1') -replace "'", "''"
$null = $ps.AddScript("& '$uiPath' -BuildOnly`n`$LASTEXITCODE")
try {
  $mtaOut = $ps.Invoke()
  $mtaCode = $mtaOut | Where-Object { $_ -is [int] } | Select-Object -First 1
  # Write-Host с версии 5.0 пишет в поток Information, а не в вывод
  $mtaText = (@($ps.Streams.Information | ForEach-Object { [string]$_ }) -join "`n")
  if ($null -eq $mtaCode) { $mtaCode = -1 }
} catch {
  $mtaCode = -1; $mtaText = $_.Exception.Message
} finally {
  $ps.Dispose(); $rs.Dispose()
}
Check 'в MTA — код 3' ($mtaCode -eq 3) ('code=' + $mtaCode)
Check 'в MTA — сказано, как запускать' (($mtaText -match 'STA') -and ($mtaText -match 'run-ui.cmd')) (($mtaText -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 2) -join ' / ')

Remove-Item $inboxTmp -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -gt 0) {
  $fails -join "`r`n" | Set-Content -Path $diagFile -Encoding UTF8
  Write-Host ("FAIL {0} / PASS {1}  (подробности: {2})" -f $fail, $pass, $diagFile)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
