# HardSearchWork — окно.
#
# Три вкладки по ТЗ: «Отправленные» и «Подготавливаются» плюс «Сессии» с
# данными инициализации. В «Отправленных» — детализация по каждой отправке:
# куда ушло, что ушло, и процент по вакансии с разбором, из чего он сложился.
#
# Почему окно собирается кодом, а не из XAML. Это решение из ui-app.ps1, и там
# оно проверено: с XAML ошибка разметки видна только при запуске, то есть
# глазами. Здесь то же самое — XAML-файл не подсказывает, что в Grid.Row стоит
# несуществующий элемент, пока окно не откроют.
#
# Данные для вкладок приходит из hsw-view.js. Окно не знает ни про SQL, ни про
# схему базы: правка запроса не должна означать правку окна.
#
# Что окно НЕ делает и почему:
# * не отправляет ничего само. Отправка идёт через браузер и почту, и это
# отдельный шаг: пока не введён вход, отправлять некуда;
# * не показывает «успех» без подтверждения. Строка попадает в «Отправленные»
# только с подтверждением от площадки, иначе это было бы то же самое враньё,
# что и «0 отправлено» вручную.
#
# Запуск: двойной щелчок по run-hsw.cmd, либо
# powershell -STA -ExecutionPolicy Bypass -File hsw-app.ps1
# Ключ -STA обязателен: WPF без однопоточной квартирации не открывается.
[CmdletBinding()]
param(
    # Вкладка при открытии. Раньше окно всегда открывалось на «Отправленные», и
    # переключение ни разу не проверялось ничем, кроме того что оно написано.
    [ValidateSet('sent', 'preparing', 'sessions')]
    [string]$Tab = 'sent',
    [switch]$NoAutoRefresh
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

# Слой представления — обычный node, читает SQLite. Вызывается в PowerShell, а не
# требует node внутри окна: так данные приходят в готовом виде и окно не зависит
# от того, где установлен node.
$script:ViewScript = Join-Path $PSScriptRoot 'hsw-view.js'

function Get-HswData {
    param([switch]$Quiet)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'node'
    $psi.Arguments = '"' + $script:ViewScript + '"'
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $PSScriptRoot
    # Кодировка вывода ЗАДАЕТСЯ ЯВНО. node печатает UTF-8, а PowerShell по
    # умолчанию читает StandardOutput в кодировке консоли, а она в свежем окне
    # cp866. Русский текст из базы приходил в окно мусором вида тХтг¬┐т┬Р°,
    # при этом текст, написанный прямо в hsw-app.ps1, отображался верно —
    # файл читался правильно, портился только путь через процесс.
    # Измерено: [Console]::OutputEncoding в свежем powershell = utf-8, но
    # OEM-кодовая страница = cp866, а StandardOutput без StandardOutputEncoding
    # декодируется по OEM. С явным UTF-8 приходит ровно исходная строка.
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    if ($p.ExitCode -ne 0 -and -not $Quiet) {
        Write-HswError 'Get-HswData' ([pscustomobject]@{
            Exception = (New-Object System.Exception("код $($p.ExitCode): $err"))
            ScriptStackTrace = 'hsw-view.js завершился с ошибкой'
        })
    }
    return ($out | ConvertFrom-Json)
}

# Цвета. Тёмная тема: окно открывают часто и подолгу, светлый фон утомляет.
#
# Хранятся СРАЗУ SolidColorBrush, а не Color. Измерено: с Color падает первое же
# присваивание Background — «Не удаётся преобразовать тип System.Windows.Media.Color
# в тип System.Windows.Media.Brush». Color и Brush не взаимозаменяемы, хотя разница
# в одну обёртку. Кисть замораживается (Freeze): незамороженная кисть привязана
# к потоку, в котором создана.
function New-Brush {
    param([string]$Hex)
    $c = [System.Windows.Media.ColorConverter]::ConvertFromString($Hex)
    $b = New-Object System.Windows.Media.SolidColorBrush($c)
    $b.Freeze()
    return $b
}

$script:Brush = @{
    Panel     = New-Brush '#161A22'
    Card      = New-Brush '#1E2430'
    CardHi    = New-Brush '#262E3D'
    Text      = New-Brush '#E6EAF2'
    Dim       = New-Brush '#8B94A6'
    Accent    = New-Brush '#4C8DFF'
    Good      = New-Brush '#3FBF7F'
    Warn      = New-Brush '#E8B339'
    Bad       = New-Brush '#E5544B'
    Line      = New-Brush '#2C3444'
}

function New-Text {
    param([string]$Text, [double]$Size = 13, [string]$Color = 'Text', [bool]$Bold = $false)
    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text = $Text
    $tb.Foreground = $script:Brush[$Color]
    $tb.FontSize = $Size
    $tb.FontFamily = New-Object System.Windows.Media.FontFamily('Segoe UI')
    if ($Bold) { $tb.FontWeight = [System.Windows.FontWeights]::SemiBold }
    $tb.TextWrapping = [System.Windows.TextWrapping]::NoWrap
    $tb.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    return $tb
}

function New-Card {
    # UIElement лежит в System.Windows, а НЕ в System.Windows.Controls. Проверено:
    # с Controls тип не резолвится и скрипт падает с «Не удалось найти тип».
    param([System.Windows.UIElement]$Content, [int]$Pad = 12)
    $bd = New-Object System.Windows.Controls.Border
    $bd.Background = $script:Brush.Card
    $bd.CornerRadius = New-Object System.Windows.CornerRadius(8)
    $bd.Padding = New-Object System.Windows.Thickness($Pad, 8, $Pad, 8)
    $bd.BorderBrush = $script:Brush.Line
    $bd.BorderThickness = New-Object System.Windows.Thickness(1)
    $bd.Child = $Content
    return $bd
}

# Процент выводится с цветом: зелёный от 70, жёлтый от 40, красный ниже. Числа
# без цвета читаются как «всё примерно одинаково», а разница между 20 и 80
# процентами — это разница между «почти наверняка нет» и «есть шанс».
function Get-PercentBrush {
    param($Percent)
    if ($null -eq $Percent) { return $script:Brush.Dim }
    if ($Percent -ge 70) { return $script:Brush.Good }
    if ($Percent -ge 40) { return $script:Brush.Warn }
    return $script:Brush.Bad
}

function New-StatTile {
    param([string]$Label, $Value, [string]$Color = 'Text')
    $st = New-Object System.Windows.Controls.StackPanel
    $st.Margin = New-Object System.Windows.Thickness(0, 0, 22, 0)
    $v = New-Text -Text ([string]$Value) -Size 26 -Color $Color -Bold $true
    $l = New-Text -Text $Label -Size 11.5 -Color 'Dim'
    $st.Children.Add($v) | Out-Null
    $st.Children.Add($l) | Out-Null
    return (New-Card -Content $st -Pad 14)
}

function New-TabButton {
    param([string]$Text, [bool]$Active, [scriptblock]$OnClick)
    $b = New-Object System.Windows.Controls.Button
    $b.Content = (New-Text -Text $Text -Size 14 -Bold $Active -Color $(if ($Active) { 'Accent' } else { 'Dim' }))
    $b.Background = [System.Windows.Media.Brushes]::Transparent
    $b.BorderThickness = New-Object System.Windows.Thickness(0)
    $b.Padding = New-Object System.Windows.Thickness(16, 10, 16, 10)
    $b.Cursor = [System.Windows.Input.Cursors]::Hand
    $b.Add_MouseEnter({ $this.Background = $script:Brush.CardHi }.GetNewClosure())
    $b.Add_MouseLeave({ $this.Background = [System.Windows.Media.Brushes]::Transparent }.GetNewClosure())
    if ($OnClick) { $b.Add_Click($OnClick) }
    return $b
}

# Строка отправки. Слева — куда, в центре — что, справа — процент. Строка
# кликабельна: она открывает детализацию, как и требует ТЗ.
function New-SentRow {
    param($Row, [scriptblock]$OnOpen)
    $sp = New-Object System.Windows.Controls.StackPanel
    $sp.Orientation = 'Horizontal'
    $sp.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)

    $okColor = if ($Row.ok) { 'Good' } else { 'Bad' }
    $dot = New-Text -Text $(if ($Row.ok) { '●' } else { '○' }) -Size 11 -Color $okColor
    $dot.Width = 16
    $sp.Children.Add($dot) | Out-Null

    $site = New-Text -Text ([string]$Row.site).ToUpper() -Size 11 -Color 'Accent' -Bold $true
    $site.Width = 62
    $sp.Children.Add($site) | Out-Null

    $vac = New-Text -Text ([string]$Row.vacancyTitle) -Size 13 -Color 'Text'
    $vac.TextTrimming = 'CharacterEllipsis'
    $vac.Width = 330
    $sp.Children.Add($vac) | Out-Null

    $comp = New-Text -Text ([string]$Row.company) -Size 12.5 -Color 'Dim'
    $comp.TextTrimming = 'CharacterEllipsis'
    $comp.Width = 170
    $sp.Children.Add($comp) | Out-Null

    $target = New-Text -Text ([string]$Row.target) -Size 12 -Color 'Dim'
    $target.TextTrimming = 'CharacterEllipsis'
    $target.Width = 210
    $sp.Children.Add($target) | Out-Null

    $when = New-Text -Text $(if ($Row.sentAt) { ([string]$Row.sentAt).Substring(5, 11) } else { '—' }) -Size 11.5 -Color 'Dim'
    $when.Width = 108
    $sp.Children.Add($when) | Out-Null

    $pct = New-Text -Text $(if ($null -ne $Row.percent) { "$($Row.percent)%" } else { '—' }) -Size 15 -Bold $true
    $pct.Foreground = Get-PercentBrush $Row.percent
    $pct.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
    $pct.Width = 62
    $sp.Children.Add($pct) | Out-Null

    $bd = New-Card -Content $sp -Pad 10
    $bd.Cursor = [System.Windows.Input.Cursors]::Hand
    $bd.Add_MouseEnter({ $this.Background = $script:Brush.CardHi }.GetNewClosure())
    $bd.Add_MouseLeave({ $this.Background = $script:Brush.Card }.GetNewClosure())
    if ($OnOpen) { $bd.Add_MouseLeftButtonDown($OnOpen) }
    return $bd
}

function New-PreparingRow {
    param($Row)
    $sp = New-Object System.Windows.Controls.StackPanel
    $sp.Orientation = 'Horizontal'

    $state = switch ([string]$Row.state) {
        'ready'  { @{ T = 'готово';    C = 'Good' } }
        default  { @{ T = 'черновик'; C = 'Dim'  } }
    }
    $badge = New-Text -Text $state.T -Size 10.5 -Color $state.C -Bold $true
    $badge.Width = 78
    $sp.Children.Add($badge) | Out-Null

    $stack = New-Text -Text ([string]$Row.stack).ToUpper() -Size 10.5 -Color 'Accent' -Bold $true
    $stack.Width = 72
    $sp.Children.Add($stack) | Out-Null

    $vac = New-Text -Text ([string]$Row.vacancyTitle) -Size 13 -Color 'Text'
    $vac.TextTrimming = 'CharacterEllipsis'
    $vac.Width = 330
    $sp.Children.Add($vac) | Out-Null

    $comp = New-Text -Text ([string]$Row.company) -Size 12.5 -Color 'Dim'
    $comp.TextTrimming = 'CharacterEllipsis'
    $comp.Width = 200
    $sp.Children.Add($comp) | Out-Null

    $len = New-Text -Text "$($Row.letterLength) симв." -Size 11.5 -Color 'Dim'
    $len.Width = 88
    $sp.Children.Add($len) | Out-Null

    # Что ещё не сделано по этой вакансии. Слово «адрес» вместо «контакта»:
    # контакт есть у почти каждой компании (сайт, страница hh), а вот адрес,
    # по которому можно ответить за вакансию, публикуют единицы. Считать одно
    # вместо другого показывало бы готовность там, где её нет.
    $lack = @()
    if ([int]$Row.hrContactsFound -eq 0) {
        if ([int]$Row.contactsFound -gt 0) { $lack += 'контакт есть, адреса для отклика нет' }
        else { $lack += 'нет адреса для отклика' }
    }
    if ([int]$Row.alreadySent -eq 0) { $lack += 'нигде не отправлено' }
    $lackText = New-Text -Text $(if ($lack.Count) { $lack -join ', ' } else { 'всё собрано' }) -Size 11.5 -Color $(if ($lack.Count) { 'Warn' } else { 'Good' })
    $lackText.TextTrimming = 'CharacterEllipsis'
    $lackText.Width = 230
    $sp.Children.Add($lackText) | Out-Null

    $pct = New-Text -Text "$($Row.letterFit)%" -Size 15 -Bold $true
    $pct.Foreground = Get-PercentBrush $Row.letterFit
    $pct.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
    $pct.Width = 62
    $sp.Children.Add($pct) | Out-Null

    return (New-Card -Content $sp -Pad 10)
}

function New-EmptyNote {
    param([string]$Text, [string]$Color = 'Dim')
    $tb = New-Text -Text $Text -Size 13 -Color $Color
    $tb.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $tb.Margin = New-Object System.Windows.Thickness(4, 14, 4, 14)
    return $tb
}

# ==== окно ====
# LoadComponent здесь НЕ вызывается намеренно. Он требует ResourceAssembly,
# то есть запись манифеста приложения. При запуске через `powershell -File`
# EntryAssembly возвращает NULL, и вызов падает с IOException:
#   "Нельзя определить ResourceAssembly".
# Измеренный факт: строка была перенесена из другого скрипта, где такого вызова
# нет. Проверка синтаксиса (check-syntax.ps1) на это НЕ ругается — она разбирает
# текст, а не исполняет его. Ловится только запуском.
$window = New-Object System.Windows.Window
$window.Title = 'HardSearchWork'
$window.Width = 1180
$window.Height = 720
$window.MinWidth = 900
$window.MinHeight = 520
$window.WindowStartupLocation = 'CenterScreen'
$window.Background = $script:Brush.Panel

# Автообновление раз в минуту: окно читает базу, а база пополняется другим
# процессом. Через минуту приложение должно показать новое само, без F5.
$script:Timer = New-Object System.Windows.Threading.DispatcherTimer
$script:Timer.Interval = [TimeSpan]::FromSeconds(60)

$root = New-Object System.Windows.Controls.Grid
$root.Background = $script:Brush.Panel
$root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition)) | Out-Null   # шапка
$root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition)) | Out-Null   # вкладки
$root.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition)) | Out-Null   # содержимое
# Высоты строк: Auto, а не заданные числа. Проверено: GridLength(78, 'Auto')
# не падает, но и не хранит 78 — Value=1, потому что при Auto значение
# игнорируется и размер меряется по содержимому. Написанное число было бы
# проигнорировано молча, а читающий код думал бы, что высота задана.
$root.RowDefinitions[0].Height = [System.Windows.GridLength]::Auto
$root.RowDefinitions[1].Height = [System.Windows.GridLength]::Auto
$root.RowDefinitions[2].Height = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)

# --- шапка: название + сводка + кнопки ---
$header = New-Object System.Windows.Controls.Grid
$header.Margin = New-Object System.Windows.Thickness(20, 14, 20, 10)
$header.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null
$header.ColumnDefinitions[0].Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)
$header.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null
$header.ColumnDefinitions[1].Width = [System.Windows.GridLength]::Auto

$titleStack = New-Object System.Windows.Controls.StackPanel
$titleStack.Children.Add((New-Text -Text 'HardSearchWork' -Size 20 -Bold $true)) | Out-Null
$script:Subtitle = New-Text -Text 'загрузка…' -Size 11.5 -Color 'Dim'
$titleStack.Children.Add($script:Subtitle) | Out-Null
$header.Children.Add($titleStack) | Out-Null

$buttons = New-Object System.Windows.Controls.StackPanel
$buttons.Orientation = 'Horizontal'

$refreshBtn = New-Object System.Windows.Controls.Button
$refreshBtn.Content = (New-Text -Text 'Обновить  (F5)' -Size 12.5 -Color 'Text')
$refreshBtn.Background = $script:Brush.Card
$refreshBtn.Foreground = $script:Brush.Text
$refreshBtn.BorderBrush = $script:Brush.Line
$refreshBtn.BorderThickness = New-Object System.Windows.Thickness(1)
$refreshBtn.Padding = New-Object System.Windows.Thickness(14, 8, 14, 8)
$refreshBtn.Cursor = [System.Windows.Input.Cursors]::Hand
$buttons.Children.Add($refreshBtn) | Out-Null

# Кнопки кладутся во ВТОРУЮ колонку. Без SetColumn они попадают в нулевую, туда
# же, где название, и накладываются на него — на снимке было видно «Vork»
# вместо «HardSearchWork» и кнопку поверх букв.
[System.Windows.Controls.Grid]::SetColumn($buttons, 1)
[System.Windows.Controls.Grid]::SetColumn($titleStack, 0)
$header.Children.Add($buttons) | Out-Null
[System.Windows.Controls.Grid]::SetRow($header, 0)
$root.Children.Add($header) | Out-Null

# --- полоса вкладок ---
$tabBar = New-Object System.Windows.Controls.StackPanel
$tabBar.Orientation = 'Horizontal'
$tabBar.Margin = New-Object System.Windows.Thickness(20, 0, 20, 0)
[System.Windows.Controls.Grid]::SetRow($tabBar, 1)
$root.Children.Add($tabBar) | Out-Null

$script:Pages = @{}
$script:TabButtons = @{}

# --- область содержимого ---
$script:Content = New-Object System.Windows.Controls.Grid
$script:Content.Margin = New-Object System.Windows.Thickness(20, 0, 20, 16)
[System.Windows.Controls.Grid]::SetRow($script:Content, 2)
$root.Children.Add($script:Content) | Out-Null

$window.Content = $root

function New-ScrollPage {
    $sp = New-Object System.Windows.Controls.StackPanel
    $sp.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
    $sc = New-Object System.Windows.Controls.ScrollViewer
    $sc.VerticalScrollBarVisibility = 'Auto'
    $sc.Content = $sp
    return @{ Page = $sc; Panel = $sp }
}

foreach ($n in @('sent', 'preparing', 'sessions')) { $script:Pages[$n] = New-ScrollPage }

# Страницы ОБЯЗАТЕЛЬНО добавляются в сетку содержимого, все три сразу, и живут
# в ней постоянно. Первая версия их создавала и НЕ добавляла, а Show-Tab вдобавок
# делал Content.Children.Clear() перед показом. Итог: область содержимого всегда
# оставалась пустой — на снимке окна виден тёмный прямоугольник без единой
# строки, при том что данные из базы приходили нормально.
# Теперь переключение вкладки меняет только Visibility, а Clear() не вызывается
# никогда: очищаются панели внутри страниц (Panel.Children.Clear()), а сами
# страницы остаются в дереве.
foreach ($n in @('sent', 'preparing', 'sessions')) {
    $script:Content.Children.Add($script:Pages[$n].Page) | Out-Null
}

function Show-Tab {
    param([string]$Name)
    foreach ($k in $script:Pages.Keys) {
        # Collapsed — это ЗНАЧЕНИЕ перечисления Visibility, а не отдельный тип.
        # [System.Windows.Collapsed] не резолвится: «Не удалось найти тип».
        $script:Pages[$k].Page.Visibility = if ($k -eq $Name) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
    }
    foreach ($k in $script:TabButtons.Keys) {
        # Активная вкладка красится заново: иначе после переключении остаются
        # цвета предыдущего выбора, и непонятно, где находишься.
        $script:TabButtons[$k].Content = (New-Text -Text $script:TabLabels[$k] -Size 14 -Bold ($k -eq $Name) -Color $(if ($k -eq $Name) { 'Accent' } else { 'Dim' }))
    }
    $script:Current = $Name
}

$script:TabLabels = @{ sent = 'Отправленные'; preparing = 'Подготавливаются'; sessions = 'Сессии и почты' }
$script:Current = $Tab

foreach ($k in @('sent', 'preparing', 'sessions')) {
    $b = New-TabButton -Text $script:TabLabels[$k] -Active ($k -eq $Tab) -OnClick { Show-Tab $k }.GetNewClosure()
    $script:TabButtons[$k] = $b
    $tabBar.Children.Add($b) | Out-Null
}

function Render-Detail {
    param($Row)
    # Детализация по отправке: куда, что, процент и из чего процент.
    $win = New-Object System.Windows.Window
    $win.Title = 'Детализация отправки'
    $win.Width = 720
    $win.Height = 520
    $win.WindowStartupLocation = 'CenterOwner'
    $win.Background = $script:Brush.Panel
    $win.Owner = $window

    $sp = New-Object System.Windows.Controls.StackPanel
    $sp.Margin = New-Object System.Windows.Thickness(20)

    function Add-Line {
        param([string]$Label, [string]$Value, [string]$Color = 'Text')
        $row = New-Object System.Windows.Controls.Grid
        $row.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
        $l = New-Text -Text $Label -Size 12 -Color 'Dim'
        $l.Width = 150
        [System.Windows.Controls.Grid]::SetColumn($l, 0)
        $v = New-Text -Text $Value -Size 13 -Color $Color
        $v.TextWrapping = [System.Windows.TextWrapping]::Wrap
        [System.Windows.Controls.Grid]::SetColumn($v, 1)
        $row.Children.Add($l) | Out-Null
        $row.Children.Add($v) | Out-Null
        $row.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null
        # Та же история с 150: при Auto число игнорируется (измерено: Value=1).
$row.ColumnDefinitions[0].Width = [System.Windows.GridLength]::Auto
        $row.ColumnDefinitions.Add((New-Object System.Windows.Controls.ColumnDefinition)) | Out-Null
        $sp.Children.Add($row) | Out-Null
    }

    Add-Line 'Вакансия' ([string]$Row.vacancyTitle)
    Add-Line 'Компания' ([string]$Row.company)
    Add-Line 'Сайт' ([string]$Row.site) 'Accent'
    Add-Line 'Куда отправлено' ([string]$Row.target)
    Add-Line 'Тема' ([string]$Row.subject)
    Add-Line 'Когда' ([string]$Row.sentAt)
    Add-Line 'Подтверждение' $(if ($Row.ok) { [string]$Row.proof } else { 'нет: ' + [string]$Row.error }) $(if ($Row.ok) { 'Good' } else { 'Bad' })

    $sep = New-Object System.Windows.Controls.Border
    $sep.Height = 1
    $sep.Background = $script:Brush.Line
    $sep.Margin = New-Object System.Windows.Thickness(0, 10, 0, 12)
    $sp.Children.Add($sep) | Out-Null

    $pctTitle = New-Object System.Windows.Controls.StackPanel
    $pctTitle.Orientation = 'Horizontal'
    $pctTitle.Children.Add((New-Text -Text 'Процент приёма' -Size 15 -Bold $true)) | Out-Null
    $bigPct = New-Text -Text $(if ($null -ne $Row.percent) { "$($Row.percent)%" } else { '—' }) -Size 30 -Bold $true
    $bigPct.Foreground = Get-PercentBrush $Row.percent
    $bigPct.Margin = New-Object System.Windows.Thickness(12, 0, 0, 0)
    $pctTitle.Children.Add($bigPct) | Out-Null
    $sp.Children.Add($pctTitle) | Out-Null

    foreach ($w in $Row.percentWhy) {
        $sp.Children.Add((New-Text -Text '· ' + $w -Size 12.5 -Color 'Dim')) | Out-Null
    }
    $sp.Children.Add((New-Text -Text 'Считается по этой вакансии, а не по компании: у одной компании бывает несколько вакансий, и отправки в одну из них не должны повышать процент другой.' -Size 11.5 -Color 'Dim')) | Out-Null

    $close = New-Object System.Windows.Controls.Button
    $close.Content = (New-Text -Text 'Закрыть' -Size 13 -Color 'Text')
    $close.Background = $script:Brush.Card
    $close.Foreground = $script:Brush.Text
    $close.BorderBrush = $script:Brush.Line
    $close.BorderThickness = New-Object System.Windows.Thickness(1)
    $close.Padding = New-Object System.Windows.Thickness(18, 8, 18, 8)
    $close.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
    $close.Margin = New-Object System.Windows.Thickness(0, 16, 0, 0)
    $close.Cursor = [System.Windows.Input.Cursors]::Hand
    $close.Add_Click({ $win.Close() })
    $sp.Children.Add($close) | Out-Null

    $win.Content = $sp
    $win.ShowDialog() | Out-Null
}

function Render-Pages {
    param($Data)

    # --- сводка ---
    # Плитки строятся В ФУНКЦИИ, а не один раз на весь рендер. Причина —
    # измерение, а не аккуратность: у элемента WPF ровно один визуальный
    # родитель. Первый вариант делал $tiles один раз и добавлял его и в
    # «Отправленные», и в «Подготавливаются». Второе добавление падало с
    #   «Указанный элемент уже является логическим дочерним для другого
    #    элемента. Сначала отсоедините его.»
    # Из этого обработчика (ContentRendered) ошибка выходит наружу как ошибка
    # ВЫЗОВА $app.Run($window) — то есть виноват оказывался Run, при том что
    # все типы были правильные. Измерено пробником: исключение из
    # обработчика события выходит из Run без указания на исходное место.
    $s = $Data.summary
    $makeTiles = {
        $t = New-Object System.Windows.Controls.StackPanel
        $t.Orientation = 'Horizontal'
        $t.Children.Add((New-StatTile -Label 'отправлено' -Value $s.sent -Color $(if ($s.sent -gt 0) { 'Good' } else { 'Dim' }))) | Out-Null
        $t.Children.Add((New-StatTile -Label 'готово к отправке' -Value $s.prepared -Color $(if ($s.prepared -gt 0) { 'Warn' } else { 'Dim' }))) | Out-Null
        $t.Children.Add((New-StatTile -Label 'вакансий в базе' -Value $s.vacancies -Color 'Text')) | Out-Null
        $t.Children.Add((New-StatTile -Label 'компаний' -Value $s.companies -Color 'Dim')) | Out-Null
        $t.Children.Add((New-StatTile -Label 'контактов' -Value $s.contacts -Color 'Dim')) | Out-Null
        $t.Children.Add((New-StatTile -Label 'вLeaksData' -Value $s.leaks -Color 'Dim')) | Out-Null
        $t.Children.Add((New-StatTile -Label 'средний процент' -Value $(if ($null -ne $s.medianPercent) { "$($s.medianPercent)%" } else { '—' }) -Color $(if ($null -ne $s.medianPercent) { 'Accent' } else { 'Dim' }))) | Out-Null
        return $t
    }
    $script:Pages.sent.Panel.Children.Add((& $makeTiles)) | Out-Null
    $script:Pages.preparing.Panel.Children.Add((& $makeTiles)) | Out-Null

    # --- Отправленные ---
    $p = $script:Pages.sent.Panel
    if (-not $Data.sent -or $Data.sent.Count -eq 0) {
        $p.Children.Add((New-EmptyNote -Text 'Отправок пока нет. Здесь появится каждая отправка: куда ушло, что ушло, и процент по вакансии. Строка кликабельна и открывает детализацию.')) | Out-Null
    } else {
        foreach ($row in $Data.sent) {
            $r = $row
            $p.Children.Add((New-SentRow -Row $r -OnOpen { Render-Detail $r }.GetNewClosure())) | Out-Null
        }
    }

    # --- Подготавливаются ---
    $p = $script:Pages.preparing.Panel
    if (-not $Data.preparing -or $Data.preparing.Count -eq 0) {
        $p.Children.Add((New-EmptyNote -Text 'Подготовленных писем пока нет. Здесь появится пачка по 10 вакансий: стек, вакансия, компания, длина письма, процент и чего не хватает до отправки.')) | Out-Null
    } else {
        foreach ($row in $Data.preparing) { $p.Children.Add((New-PreparingRow -Row $row)) | Out-Null }
    }

    # --- Сессии и почты ---
    $p = $script:Pages.sessions.Panel
    $p.Children.Add((New-Text -Text 'Сессии площадок' -Size 15 -Bold $true)) | Out-Null
    $p.Children.Add((New-Text -Text 'Вход нужен только для отправки: сбор вакансий с открытых страниц работает без него.' -Size 11.5 -Color 'Dim')) | Out-Null
    $sep = New-Object System.Windows.Controls.Border
    $sep.Height = 1
    $sep.Background = $script:Brush.Line
    $sep.Margin = New-Object System.Windows.Thickness(0, 10, 0, 12)
    $p.Children.Add($sep) | Out-Null
    if (-not $Data.sessions -or $Data.sessions.Count -eq 0) {
        $p.Children.Add((New-EmptyNote -Text 'Сессии не проверялись.')) | Out-Null
    } else {
        foreach ($sn in $Data.sessions) {
            $row = New-Object System.Windows.Controls.StackPanel
            $row.Orientation = 'Horizontal'
            $row.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
            $st = if ($sn.loggedIn) { @{ T = 'вход есть'; C = 'Good' } } else { @{ T = 'нет входа'; C = 'Bad' } }
            $b = New-Text -Text $st.T -Size 11 -Color $st.C -Bold $true
            $b.Width = 92
            $row.Children.Add($b) | Out-Null
            $site = New-Text -Text ([string]$sn.site) -Size 13 -Color 'Text'
            $site.Width = 120
            $row.Children.Add($site) | Out-Null
            $how = New-Text -Text ([string]$sn.how) -Size 11.5 -Color 'Dim'
            $how.TextTrimming = 'CharacterEllipsis'
            $row.Children.Add($how) | Out-Null
            $p.Children.Add((New-Card -Content $row -Pad 10)) | Out-Null
        }
    }

    $sep2 = New-Object System.Windows.Controls.Border
    $sep2.Height = 1
    $sep2.Background = $script:Brush.Line
    $sep2.Margin = New-Object System.Windows.Thickness(0, 16, 0, 12)
    $p.Children.Add($sep2) | Out-Null
    $p.Children.Add((New-Text -Text 'Почты для рассылки' -Size 15 -Bold $true)) | Out-Null
    if (-not $Data.mailboxes -or $Data.mailboxes.Count -eq 0) {
        $p.Children.Add((New-EmptyNote -Text 'Ящики не заведены. Создай mailboxes.csv рядом с приложением — формат как в mailboxes.csv.example.' -Color 'Warn')) | Out-Null
    } else {
        foreach ($m in $Data.mailboxes) {
            $row = New-Object System.Windows.Controls.StackPanel
            $row.Orientation = 'Horizontal'
            $row.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
            $b = if ($m.hasPassNow) { @{ T = 'готов'; C = 'Good' } } else { @{ T = 'нет пароля'; C = 'Bad' } }
            $x = New-Text -Text $b.T -Size 11 -Color $b.C -Bold $true
            $x.Width = 92
            $row.Children.Add($x) | Out-Null
            $u = New-Text -Text ("{0} <{1}>" -f $m.name, $m.user) -Size 13 -Color 'Text'
            $u.Width = 300
            $row.Children.Add($u) | Out-Null
            $h = New-Text -Text ("{0}:{1}" -f $m.host, $m.port) -Size 11.5 -Color 'Dim'
            $h.Width = 220
            $row.Children.Add($h) | Out-Null
            $e = New-Text -Text ("переменная {0}" -f $m.passEnv) -Size 11 -Color 'Dim'
            $row.Children.Add($e) | Out-Null
            $p.Children.Add((New-Card -Content $row -Pad 10)) | Out-Null
        }
    }
}

function Update-Data {
    param([switch]$Quiet)
    $data = Get-HswData -Quiet:$Quiet
    foreach ($k in $script:Pages.Keys) {
        $script:Pages[$k].Panel.Children.Clear()
    }
    Render-Pages $data
    $s = $data.summary
    $script:Subtitle.Text = "отправлено {0} · готово {1} · вакансий {2} · компаний {3} · контактов {4} · площадок со входом {5} из {6} · почт {7} из {8}" -f `
        $s.sent, $s.prepared, $s.vacancies, $s.companies, $s.contacts, $s.sessionsLoggedIn, $s.sessionsChecked, $s.mailUsable, $s.mailTotal
    Show-Tab $script:Current
}

$refreshBtn.Add_Click({ Update-Data })
$window.Add_KeyDown({
    if ($_.Key -eq [System.Windows.Input.Key]::F5) { Update-Data }
}.GetNewClosure())
$script:Timer.Add_Tick({ Update-Data }.GetNewClosure())
$script:Timer.Start()

# Разбор исключений пишется в файл, а не в stderr. Причина измерена: при
# запуске двойным щелчком через run-hsw.cmd stderr некуда смотреть, и текст
# ошибки WPF на русском искажается OEM-кодировкой консоли. Файл UTF-8 читается.
# Это же выяснилось по пути: ошибка из обработчика события (ContentRendered)
# выходит из $app.Run(...) и выглядит как ошибка самого Run — с сообщением
# про неверный тип аргумента. Настоящее место видно только по стеку.
$script:ErrorLog = Join-Path $PSScriptRoot 'hsw-error.log'
function Write-HswError {
    param([string]$Where, $Err)
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $Where)
    $e = $Err.Exception
    $i = 0
    while ($null -ne $e -and $i -lt 8) {
        $lines.Add("  [$i] " + $e.GetType().FullName + ': ' + $e.Message)
        if ($e.StackTrace) {
            foreach ($sl in ($e.StackTrace -split "`r?`n" | Select-Object -First 6)) { $lines.Add('       ' + $sl.Trim()) }
        }
        $e = $e.InnerException
        $i++
    }
    # ScriptStackTrace указывает строку в hsw-app.ps1, а StackTrace — только
    # внутри .NET. Первое и есть то место, где написан вызов.
    if ($Err.ScriptStackTrace) {
        $lines.Add('  скрипт:')
        foreach ($sl in ($Err.ScriptStackTrace -split "`r?`n" | Select-Object -First 8)) { $lines.Add('       ' + $sl.Trim()) }
    }
    $prev = if (Test-Path $script:ErrorLog) { Get-Content $script:ErrorLog -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Last 40 } else { @() }
    @($prev) + $lines | Out-File -FilePath $script:ErrorLog -Encoding utf8
}

# Update-Data обёрнут: он зовётся из трёх мест (клик, F5, таймер, плюс
# ContentRendered), и без обёртки исключение в любом из них убивает либо
# приложение, либо обработчик молча, и непонятно, почему вкладка пустая.
function Update-DataSafe {
    param([switch]$Quiet)
    try {
        Update-Data -Quiet:$Quiet
    } catch {
        Write-HswError 'Update-Data' $_
        $script:Subtitle.Text = 'ошибка чтения данных — подробности в hsw-error.log'
    }
}

$window.Add_ContentRendered({
    Update-DataSafe
    Show-Tab $Tab
}.GetNewClosure())
if ($NoAutoRefresh) {
    # Автообновление выключено: при -Tab и снимке окна таймер перерисовывает
    # вкладку, и непонятно, что именно попало в кадр.
    $script:Timer.Stop()
} else {
    $script:Timer.Add_Tick({ Update-DataSafe }.GetNewClosure())
}
$refreshBtn.Add_Click({ Update-DataSafe })

# Проверка, что окно вообще может открыться: без интерактивной сессии WPF
# падает, и об этом должен быть понятный вывод, а не стектрейс.
if (-not [System.Windows.Forms.SystemInformation]::UserInteractive) {
    [System.Windows.MessageBox]::Show(
        "Нет интерактивного рабочего стола — окно не откроется.`nЗапускай двойным щелчком по run-hsw.cmd из проводника, а не как службу.`nПодробности: $script:ErrorLog",
        'HardSearchWork', 'OK', 'Warning') | Out-Null
    exit 3
}

$app = New-Object System.Windows.Application
$app.MainWindow = $window
try {
    $app.Run($window) | Out-Null
    Write-HswError 'Run завершился' ([pscustomobject]@{ Exception = $null; ScriptStackTrace = 'приложение закрылось штатно' })
} catch {
    Write-HswError 'Run' $_
    # Пользователю показывается факт падения и где смотреть. Молчаливый выход
    # выглядит как «окно не открылось, ну и ладно», и это хуже стектрейса.
    [System.Windows.MessageBox]::Show(
        "Окно не смогло отрисоваться.`n`n" + $_.Exception.Message + "`n`nПодробности: $script:ErrorLog",
        'HardSearchWork', 'OK', 'Error') | Out-Null
    exit 4
}