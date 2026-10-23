<#
  schet.ps1 — генератор счёта на оплату (этап B4: договор + предоплата).

  ГЛАВНОЕ ПРО ТЕРМИНЫ (их путают, и из-за этого клиент платит не туда):
    Номер счёта     — номер ДОКУМЕНТА, мой счётчик: 2026-001.
                      Стоит в шапке и в назначении платежа, чтобы клиент и я
                      ссылались на один и тот же документ.
    Расчётный счёт  — 20 цифр, банковский счёт в платёжных реквизитах.
                      Это то, куда реально уходят деньги.
    БИК             — 9 цифр, код банка из реквизитов.
  Номер счёта НЕ подставляется в реквизиты, а расчётный счёт не является
  «номером счёта» из шапки. В документе они подписаны разными словами,
  чтобы никто не перепутал.

  Реквизиты исполнителя не выдумываются: лежат в requisites.txt рядом.
  Шаблон — requisites.example.txt. Пока файла нет, счёт не пишется на диск
  (чтобы случайно не отправить клиенту документ с прочерками), -Preview
  всё равно показывает вёрстку.

  Run:
    powershell -ExecutionPolicy Bypass -File schet.ps1 -Id d001                 # предоплата 50%
    powershell -ExecutionPolicy Bypass -File schet.ps1 -Id d001 -Amount 15000   # своя сумма
    powershell -ExecutionPolicy Bypass -File schet.ps1 -Id d001 -Full          # остаток
    powershell -ExecutionPolicy Bypass -File schet.ps1 -Preview -Id d001       # не тратит номер
    powershell -ExecutionPolicy Bypass -File schet.ps1 -Check                  # проверить реквизиты
#>
[CmdletBinding()]
param(
  [string]$Id = '',
  [string]$DealsFile = 'deals.csv',
  [int]$Amount = 0,
  [switch]$Full,
  [switch]$Preview,
  [switch]$Check,
  [string]$ReqFile = 'requisites.txt',
  [string]$OutDir = 'schet',
  [int]$DueDays = 3,
  [string]$Contract = '________ (номер и дата — впиши или отправь вместе со счётом)'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ---- реквизиты исполнителя: key = value, порядок не важен ----
# Ключ можно назвать как удобно — банки называют одно и то же по-разному.
# В Сбер Онлайне это поле называется «Номер счёта», и это РОВНО то же самое,
# что расчётный счёт: отдельного поля «расчётный счёт» в банке нет.
$reqAliases = @{
  'name'    = @('name', 'имя', 'исполнитель', 'получатель', 'фио')
  'inn_kpp' = @('inn_kpp', 'inn', 'инн', 'инн_кпп', 'иннкпп', 'inn/кпп')
  'rs'      = @('rs', 'рс', 'счёт', 'счет', 'номер_счёта', 'номер_счета', 'номер-счёта', 'номер-счета', 'account', 'account_number', 'расчётный_счёт', 'расчетный_счёт', 'расчетный_счет')
  'bik'     = @('bik', 'бик')
  'bank'    = @('bank', 'банк')
  'ks'      = @('ks', 'кс', 'кор_счёт', 'кор_счет', 'корсчёт', 'корсчет', 'корреспондентский_счёт')
  'nds'     = @('nds', 'ндс')
}
$reqAlias = @{}
foreach ($canon in $reqAliases.Keys) {
  foreach ($a in $reqAliases[$canon]) { $reqAlias[$a] = $canon }
}

function Get-Req {
  param([string]$Path)
  $r = @{}
  if (-not (Test-Path $Path)) { return $r }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $key = $t.Substring(0, $i).Trim().ToLower() -replace '\s+', '_'
    $val = $t.Substring($i + 1).Trim()
    if ($reqAlias.ContainsKey($key)) { $key = $reqAlias[$key] }
    if ($key -notin $reqAliases.Keys) { $r['__unknown_' + $key] = $val; continue }
    $r[$key] = $val
  }
  return $r
}

# ---- контрольные суммы (ИНН 10/12 знаков и хвостовые 3 знака счёта) ----
function Get-InnCheckKey {
  param([int[]]$d)
  $w = @(2, 4, 10, 3, 5, 9, 4, 6, 8)
  $s = 0
  for ($i = 0; $i -lt 9; $i++) { $s += $d[$i] * $w[$i] }
  return ($s % 11) % 10
}

function Get-Tail3 {
  # 3 знака, которые стоят в конце расчётного счёта: коэффициенты 7,1,2,4,10,3,5,9,4,6,8
  # по группам: 11 знаков, потом 3, потом 3.
  param([int[]]$d)
  $w = @(7, 1, 2, 4, 10, 3, 5, 9, 4, 6, 8)
  $out = ''
  foreach ($g in @(0, 1, 2)) {
    $s = 0
    for ($i = 0; $i -lt 3; $i++) {
      $idx = $g * 3 + $i
      if ($idx -ge $d.Count) { break }
      $s += $d[$idx] * $w[$i]
    }
    $out += [string]($s % 10)
  }
  return $out
}

function To-Digits {
  param([string]$s)
  return @($s.ToCharArray() | ForEach-Object { [int]$_ - 48 })
}

# $req: хеш реквизитов, $problems: список строк. Возвращает массив строк.
function Test-Req {
  param([hashtable]$r, [string[]]$need)
  $bad = @()
  foreach ($k in $need) {
    if (-not $r.ContainsKey($k) -or -not $r[$k]) { $bad += "не заполнено поле '$k'"; continue }
    $v = $r[$k]
    if ($k -eq 'bik') {
      if ($v -notmatch '^\d{9}$') { $bad += "БИК '$v' — не 9 цифр" }
    }
    elseif ($k -eq 'rs') {
      if ($v -notmatch '^\d{20}$') {
        if ($v -match '^\d{16}$' -and $v -match '^[24]') {
          $bad += "'$v' — это номер КАРТЫ (16 цифр), а нужен номер счёта (20 цифр). В Сбер Онлайне: «Карты и овердрафты» -> твоя карта -> «Реквизиты». Поле называется «Номер счёта» — это и есть расчётный счёт"
        }
        else {
          $bad += "расчётный счёт '$v' — не 20 цифр"
        }
      }
      else {
        $d = To-Digits $v
        $tail = [string]$d[17] + [string]$d[18] + [string]$d[19]
        if ((Get-Tail3 $d[0..16]) -ne $tail) {
          $bad += "расчётный счёт '$v' — контрольные 3 цифры не сходятся (возможна опечатка)"
        }
      }
    }
    elseif ($k -eq 'ks') {
      if ($v -notmatch '^\d{20}$') { $bad += "корр. счёт '$v' — не 20 цифр (у корр. счёта хвостовые 3 цифры = 0,000 не проверяются так же)" }
    }
    elseif ($k -eq 'inn_kpp') {
      # ИНН 10 (юрлицо), 12 (ИП на УСН и самозанятый) или 15 цифр (ИП на ОСНО/патент).
      # КПП из 4 цифр после слеша: у ИП есть, у самозанятого/физлица — нет, и это норма.
      if ($v -notmatch '^(\d{10}|\d{12}|\d{15})(/\d{4})?$') {
        $bad += "ИНН/КПП '$v' — ждём ИНН 10, 12 или 15 цифр и необязательно /КПП из 4 цифр (у самозанятого КПП нет)"
      }
      else {
        $inn = ($v -split '/')[0]
        $d = To-Digits $inn
        $ok = $true
        if ($inn.Length -eq 10) { $ok = ((Get-InnCheckKey $d[0..8]) -eq $d[9]) }
        elseif ($inn.Length -eq 12) {
          $n1 = Get-InnCheckKey $d[0..9]
          $ok = ($n1 -eq $d[10])
          if ($ok) {
            $w2 = @(7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
            $s = 0; for ($i = 0; $i -lt 10; $i++) { $s += $d[$i] * $w2[$i] }
            $ok = (((($s % 11) % 10)) -eq $d[11])
          }
        }
        if (-not $ok) { $bad += "ИНН '$inn' — контрольное число не сходится (опечатка)" }
      }
    }
  }
  return $bad
}

$reqPath = if ([IO.Path]::IsPathRooted($ReqFile)) { $ReqFile } else { Join-Path $root $ReqFile }
$req = Get-Req $reqPath
$need = @('name', 'inn_kpp', 'rs', 'bik', 'bank', 'ks')
$reqBad = Test-Req $req $need

if ($Check) {
  Write-Host "=== реквизиты: $reqPath ==="
  if (-not (Test-Path $reqPath)) { Write-Host "файла нет. Скопируй: requisites.example.txt -> $ReqFile" -ForegroundColor Red }
  foreach ($k in $need) {
    $v = if ($req.ContainsKey($k)) { $req[$k] } else { '(пусто)' }
    Write-Host ("  {0,-8} {1}" -f $k, $v)
  }
  if ($reqBad.Count -eq 0 -and (Test-Path $reqPath)) {
    Write-Host '  всё сходится: ИНН, БИК, длина счёта и контрольные цифры.' -ForegroundColor Green
    Write-Host '  (7-значный ключ банка внутри счёта не проверяется — банк отклонит перевод, если он неверный.)' -ForegroundColor DarkGray
  }
  else {
    Write-Host "  проблемы ($($reqBad.Count)):" -ForegroundColor Yellow
    $reqBad | ForEach-Object { Write-Host "    - $_" -ForegroundColor Yellow }
  }
  $unknown = @($req.Keys | Where-Object { $_.StartsWith('__unknown_') })
  if ($unknown.Count -gt 0) {
    Write-Host '  неизвестные поля (возможно, опечатка в названии):' -ForegroundColor DarkYellow
    $unknown | ForEach-Object { Write-Host ("    - {0} = {1}" -f $_.Substring(10), $req[$_]) -ForegroundColor DarkYellow }
  }
  Write-Host ''
  Write-Host '  поле rs можно назвать как угодно: rs, счёт, номер_счета, account' -ForegroundColor DarkGray
  return
}

# ---- сделка ----
$db = if ([IO.Path]::IsPathRooted($DealsFile)) { $DealsFile } else { Join-Path $root $DealsFile }
if (-not (Test-Path $db)) { throw "нет доски сделок: $db. Сначала pipeline.ps1 init && add" }
$rows = @(Import-Csv $db)
$deal = $null
if ($Id) { $deal = $rows | Where-Object { $_.id -eq $Id } | Select-Object -First 1 }
else { $deal = $rows | Where-Object { $_.stage -eq 'b3' -or $_.stage -eq 'b2' } | Select-Object -First 1 }
if (-not $deal) { throw "не нашёл сделку $Id" }

# ---- сумма: предоплата по умолчанию, -Full — остаток, -Amount — вручную ----
$value = [int]$deal.value_rub
$paid = [int]$deal.paid_rub
if ($Amount -gt 0) { $sum = $Amount; $what = 'частичная оплата по счёту' }
elseif ($Full) {
  if ($value -le 0) { throw "в сделке $($deal.id) не задана сумма: pipeline.ps1 stage -Id $($deal.id) -To b3 -Value <сумма>" }
  $sum = $value - $paid
  $what = 'окончательный расчёт'
}
elseif ([int]$deal.prepay_rub -gt 0) { $sum = [int]$deal.prepay_rub; $what = 'предоплата 50%' }
elseif ($value -gt 0) { $sum = [Math]::Round(($value * 0.5) / 500) * 500; $what = 'предоплата 50%' }
else { throw "в сделке $($deal.id) не задана сумма: pipeline.ps1 stage -Id $($deal.id) -To b3 -Value <сумма> -Prepay <предоплата>" }
if ($sum -le 0) { throw "сумма к оплате нулевая (value=$value, paid=$paid)" }

# ---- номер счёта: свой счётчик, год + порядковый номер. ----
# Черновик номер не тратит, отказ по реквизитам — тоже: счётчик двигается только
# после того, как файл реально записан (иначе в нумерации будут дыры).
$outPath = if ([IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $root $OutDir }
$numFile = Join-Path $outPath 'number.txt'
$today = Get-Date
$year = $today.ToString('yyyy')
$last = 0
if (Test-Path $numFile) {
  $raw = [IO.File]::ReadAllText($numFile).Trim()
  if ($raw -match '^(\d{4})\s+(\d+)$' -and $Matches[1] -eq $year) { $last = [int]$Matches[2] }
}
$num = $last + 1
if ($Preview) { $docNum = '{0}-{1:D3} (черновик)' -f $year, $num } else { $docNum = '{0}-{1:D3}' -f $year, $num }

$date = $today.ToString('dd.MM.yyyy')
$due = $today.AddDays($DueDays).ToString('dd.MM.yyyy')
$nds = if ($req.ContainsKey('nds')) { $req['nds'] } else { 'НДС не облагается' }
$buyerInn = if ($deal.inn) { $deal.inn } else { 'не указан (дописать)' }

$doc = @"
════════════════════════════════════════════════════════════════════
СЧЁТ НА ОПЛАТУ № {0} от {1}
════════════════════════════════════════════════════════════════════
  Номер счёта (документа)  : {0}
  Дата выставления         : {1}
  Оплатить до              : {2}

ИСПОЛНИТЕЛЬ
  Наименование             : {3}
  ИНН / КПП                : {4}
  Расчётный счёт (в банке) : {5}    <- 20 цифр, сюда платить. Это НЕ номер счёта выше.
  БИК                      : {6}    <- 9 цифр
  Банк                     : {7}
  Корреспондентский счёт   : {8}

ЗАКАЗЧИК
  Наименование             : {9}
  ИНН                      : {10}
  Основание                : {11}

════════════════════════════════════════════════════════════════════
ПРЕДМЕТ ОПЛАТЫ
  1. Разработка сайта, {12}                              {13,8} ₽

  ИТОГО к оплате                                        {13,8} ₽
  В том числе                                          {13,8} ₽ — {14}

════════════════════════════════════════════════════════════════════
НАЗНАЧЕНИЕ ПЛАТЕЖА (вписать в назначение в банке или в платёжке):
  Оплата по счёту № {0} от {1}, ИНН {4}, {12}
════════════════════════════════════════════════════════════════════
"@ -f $docNum, $date, $due,
$req['name'], $req['inn_kpp'], $req['rs'], $req['bik'], $req['bank'], $req['ks'],
$deal.company, $buyerInn, $Contract, $what, ('{0:N0}' -f $sum), $nds

Write-Host ("{0}  {1}" -f $deal.id, $deal.company)
Write-Host ("  счёт № {0} от {1}" -f $docNum, $date)
Write-Host ("  сумма: {0} ₽ ({1})   оплатить до {2}" -f ('{0:N0}' -f $sum), $what, $due)
Write-Host ("  расчётный счёт исполнителя: {0}  БИК {1}" -f $req['rs'], $req['bik'])
Write-Host '  в назначении платежа указывается НОМЕР СЧЁТА (документа), а не расчётный счёт.'

if ($reqBad.Count -gt 0) {
  Write-Host ''
  Write-Host "РЕКВИЗИТЫ НЕ ПРОШЛИ ПРОВЕРКУ ($($reqBad.Count)) — счёт на диск не пишу:" -ForegroundColor Red
  $reqBad | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Write-Host "заполни $ReqFile (шаблон requisites.example.txt) и запусти ещё раз" -ForegroundColor Red
  if ($Preview) { Write-Host ''; Write-Host $doc -ForegroundColor DarkGray }
  exit 2
}

if ($Preview) {
  Write-Host ''
  Write-Host $doc -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  черновик: номер счёта не потрачен, файл не создан.' -ForegroundColor DarkGray
  return
}

$name = '{0}-счёт-{1}.txt' -f $deal.id, $docNum
if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }
$outFile = Join-Path $outPath $name
[IO.File]::WriteAllText($outFile, $doc, (New-Object Text.UTF8Encoding $true))
# счётчик двигаем только после успешной записи файла
[IO.File]::WriteAllText($numFile, ('{0} {1}' -f $year, $num), (New-Object Text.UTF8Encoding $true))
Write-Host ("  файл: {0}\{1}" -f $OutDir, $name)
Write-Host ("  дальше: отправить файл, клиент платит, потом pipeline.ps1 stage -Id {0} -To b4 -Paid <сумма>" -f $deal.id)