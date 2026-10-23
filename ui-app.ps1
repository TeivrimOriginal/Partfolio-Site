<#
  ui-app.ps1 — desktop-приложение: окно с двумя вкладками.

  Задача, ради которой оно сделано, звучит так: «понятно, какой мой емейл кому
  отправил письмо». Поэтому колонка «ЯЩИК» стоит второй, а строки без ящика
  (старые отправки, сделанные до появления колонки from) показываются
  приглушённо и с честной пометкой, а не пустой ячейкой.

  Разметка — в ui-app.xaml, логика здесь. Так сделано после двух неудач:
    1. DataGrid в коде: заданы Background и AlternatingRowBackground, тема WPF не
       переопределена — светлыми остались заголовки колонок, шапка вкладок и
       строки. Читалось плохо.
    2. ListBox с DataTemplate, собранным в коде: DataTemplate.VisualTree —
       свойство только для чтения, шаблон не собрался вовсе.
  В XAML тема это стили, а ошибка разметки ловится парсером при загрузке.

  Обновление данных вынесено в функцию Update-Ui, а не в скриптблок: скриптблок,
  созданный внутри функции, не видит её локальные переменные, и проверять такое
  поведение пришлось вслепую.

  Состояние лежит в $script:uiState, а не в $ui: $ui и $script:ui — одна и та же
  переменная (регистр не важен, $script: — префикс области), и строка
  $ui = New-... перетирала состояние окна.

  Минимализм — не украшение, а требование: два экрана, одна кнопка, одна
  строка состояния.

  Запуск:
    powershell -STA -ExecutionPolicy Bypass -File ui-app.ps1
    или run-ui.cmd
#>
[CmdletBinding()]
param(
  [string]$SentLog = '',
  [string]$InboxFile = '',
  [switch]$NoAutoRefresh,
  [switch]$BuildOnly           # собрать окно и выйти, не показывая (для тестов)
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
. (Join-Path $root 'ui-data.ps1')

if (-not $SentLog) { $SentLog = Join-Path $root 'sent-log.csv' }
if (-not $InboxFile) { $InboxFile = Join-Path $root 'inbox-replies.csv' }

# STA обязателен для WPF. Без него окно не откроется, а ошибка будет невнятной,
# поэтому проверяем сразу и говорим прямо, что запускать.
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
  Write-Host 'WPF требует STA. Запусти так: powershell -STA -ExecutionPolicy Bypass -File ui-app.ps1' -ForegroundColor Yellow
  Write-Host 'Или просто: run-ui.cmd' -ForegroundColor Yellow
  exit 3
}

Add-Type -AssemblyName PresentationFramework | Out-Null
Add-Type -AssemblyName PresentationCore | Out-Null
Add-Type -AssemblyName WindowsBase | Out-Null

$xamlPath = Join-Path $root 'ui-app.xaml'
if (-not (Test-Path $xamlPath)) {
  Write-Host ("нет разметки: " + $xamlPath) -ForegroundColor Red
  exit 2
}

try {
  # Загрузка файла, а не XmlReader по тексту: XamlReader.Load умеет
  # разрешать x:Name в дерево, иначе FindName ничего не найдёт.
  # XamlReader.Load принимает XmlReader и разрешает x:Name прямо в дерево.
  # Типа System.Xml.XamlReader не существует (проверено) — нужен
  # System.Xml.XmlReader вместе с System.Windows.Markup.XamlReader.
  #
  # Именно StringReader, а НЕ File.OpenText: во втором случае файл разметки
  # остаётся занятым на всё время работы окна, и ui-app.xaml нельзя
  # отредактировать, пока приложение открыто. Проверено: OpenText держал файл
  # заблокированным, и правка падала с «Процесс не может получить доступ».
  $xr = [System.Xml.XmlReader]::Create((New-Object System.IO.StringReader([IO.File]::ReadAllText($xamlPath, [Text.Encoding]::UTF8))))
  try { $win = [System.Windows.Markup.XamlReader]::Load($xr) }
  finally { $xr.Dispose() }
} catch {
  Write-Host ('РАЗМЕТКА НЕ ЗАГРУЗИЛАСЬ: ' + $_.Exception.Message) -ForegroundColor Red
  exit 2
}

function El([string]$name) {
  $o = $win.FindName($name)
  if ($null -eq $o) { throw "в разметке нет элемента с именем '$name'" }
  return $o
}
$sentList = El 'sentList'
$inboxList = El 'inboxList'
$sentEmpty = El 'sentEmpty'
$inboxEmpty = El 'inboxEmpty'
$statusTb = El 'statusTb'
$sumTb = El 'sumTb'
$refreshBtn = El 'refreshBtn'
$sentRoot = El 'sentRoot'
$inboxRoot = El 'inboxRoot'
$tabSentBtn = El 'tabSentBtn'
$tabInboxBtn = El 'tabInboxBtn'

# Цвета палитры нужны коду: кнопки-вкладки подсвечиваются вручную, а не триггером
$brBg = [Windows.Media.BrushConverter]::new().ConvertFromString('#14161A')
$brPanel = [Windows.Media.BrushConverter]::new().ConvertFromString('#1B1E24')
$brLine = [Windows.Media.BrushConverter]::new().ConvertFromString('#2A2E36')
$brText = [Windows.Media.BrushConverter]::new().ConvertFromString('#E6E8EB')
$brMuted = [Windows.Media.BrushConverter]::new().ConvertFromString('#8A9099')
$brTabOff = [Windows.Media.BrushConverter]::new().ConvertFromString('#191C21')

$script:uiState = @{ sentLog = $SentLog; inboxFile = $InboxFile; tab = 'sent'; data = $null }

# Наполнение интерфейса данными.
function Update-Ui {
  $d = Get-UiState -SentLog $script:uiState.sentLog -InboxFile $script:uiState.inboxFile
  $script:uiState.data = $d
  $sentList.ItemsSource = $d.sent
  $inboxList.ItemsSource = $d.inbox
  $sentEmpty.Visibility = if ($d.sent.Count -gt 0) { [Windows.Visibility]::Collapsed } else { [Windows.Visibility]::Visible }
  $inboxEmpty.Visibility = if ($d.inbox.Count -gt 0) { [Windows.Visibility]::Collapsed } else { [Windows.Visibility]::Visible }
  $statusTb.Text = ('обновлено ' + (Get-Date -Format 'HH:mm:ss'))
  $parts = @()
  foreach ($b in $d.boxes) { $parts += ($b.box + ' — ' + $b.sent) }
  if ($parts.Count -eq 0) { $parts += 'ящики ещё не использовались' }
  $sumTb.Text = (($parts -join '   ·   ') + '   ·   отправлено ' + $d.sentOk + '   ·   ошибок ' + $d.sentErr + '   ·   ответов ' + $d.replies)
  Show-Tab $script:uiState.tab
  return $d
}

# Переключение вкладок: подсветка кнопки и видимость панели задаются здесь же,
# потому что системная тема рисует заголовок вкладки сама и перекрывает стиль
function Show-Tab([string]$which) {
  $script:uiState.tab = $which
  $onSent = ($which -eq 'sent')
  $sentRoot.Visibility = if ($onSent) { [Windows.Visibility]::Visible } else { [Windows.Visibility]::Collapsed }
  $inboxRoot.Visibility = if ($onSent) { [Windows.Visibility]::Collapsed } else { [Windows.Visibility]::Visible }
  $tabSentBtn.Background = if ($onSent) { $brPanel } else { $brTabOff }
  $tabSentBtn.Foreground = if ($onSent) { $brText } else { $brMuted }
  $tabSentBtn.BorderBrush = if ($onSent) { $brPanel } else { $brLine }
  $tabInboxBtn.Background = if ($onSent) { $brTabOff } else { $brPanel }
  $tabInboxBtn.Foreground = if ($onSent) { $brMuted } else { $brText }
  $tabInboxBtn.BorderBrush = if ($onSent) { $brLine } else { $brPanel }
  $tabSentBtn.Content = ('Отправленные · ' + @($sentList.ItemsSource).Count)
  $tabInboxBtn.Content = ('Полученные · ' + @($inboxList.ItemsSource).Count)
}

$refreshBtn.Add_Click({ Update-Ui })
$tabSentBtn.Add_Click({ Show-Tab 'sent' })
$tabInboxBtn.Add_Click({ Show-Tab 'inbox' })
$win.Add_KeyDown({
    param($s, $e)
    if ($e.Key -eq [Windows.Input.Key]::F5) { Update-Ui }
  })
foreach ($l in @($sentList, $inboxList)) {
  $l.Add_MouseDoubleClick({
      param($s, $e)
      $row = $s.SelectedItem
      if ($null -ne $row) {
        $txt = (@($row.PSObject.Properties | ForEach-Object { $_.Name + '=' + $_.Value }) -join '; ')
        try { [Windows.Clipboard]::SetText($txt); $statusTb.Text = 'строка скопирована' } catch { }
      }
    })
}
$win.Add_ContentRendered({ Update-Ui })

$timer = $null
if (-not $NoAutoRefresh) {
  $timer = New-Object Windows.Threading.DispatcherTimer
  $timer.Interval = [TimeSpan]::FromSeconds(60)
  $timer.Add_Tick({ Update-Ui })
  $timer.Start()
}

# первый проход сразу, чтобы окно не показывалось пустым на кадр
$d = Update-Ui

if ($BuildOnly) {
  Write-Host ('окно собрано: колонок отправлено 6, входящих 5, строк ' + $d.sent.Count +
    ', в таблице ' + @($sentList.ItemsSource).Count +
    ', входящих в таблице ' + @($inboxList.ItemsSource).Count)
  exit 0
}
$null = $win.ShowDialog()
exit 0
