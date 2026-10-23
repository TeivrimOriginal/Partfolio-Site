<#
  test-bounce-scan.ps1 — проверяет, что разборщик отказов не выкидывает живые лиды.

  Почему этот тест вообще нужен. Первая версия bounce-scan.ps1 работала
  «на глаз»: брала вокруг адреса ±200 символов и первое подошедшее правило.
  На нормальном отказе Яндекса это давало две противоположные ошибки:
    · «552 5.2.2 Mailbox full»  → «адрес отключён» → мёртв (ящик живой!)
    · «451 try again later»     → «непонятный отказ» → мёртв (ящик живой!)
  Обе выкидывали бы рабочий лид из воронки после первого же отказа.
  Ошибка в эту сторону дороже всего: письмо уже отправлено, деньги потрачены
  на отправку, а лид вычеркнут.

  Здесь фиксируем правильный порядок: сначала спасаем (alive/retry), потом судим.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pass = 0; $fail = 0
function Check { param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else { $script:fail++; Write-Host "  FAIL  $N  $D" }
}

$scanner = Join-Path $root 'bounce-scan.ps1'
Check 'разборщик отказов существует' (Test-Path $scanner) $scanner

# снимок боевой воронки и журнала мёртвых: тест не должен их менять
$dbPath = Join-Path $root 'deals.csv'
$deadPath = Join-Path $root 'dead-addresses.csv'
$dbBefore = (Get-Item $dbPath -ErrorAction SilentlyContinue).LastWriteTimeUtc
$deadBefore = (Get-Item $deadPath -ErrorAction SilentlyContinue).LastWriteTimeUtc
$deadCountBefore = @(Import-Csv $deadPath -ErrorAction SilentlyContinue).Count

function Run-Scan([string]$body) {
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, $body, (New-Object Text.UTF8Encoding $false))
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $scanner -File $tmp -DryRun 2>&1 | Out-String
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  return $out
}

# --- 1. отказ Яндекса: переполнен / отложен / несуществующий в одном письме ---
$ya = @'
This is the mail system at host mxsrv.yandex.net.

<land7777@yandex.ru>: host mxsrv.yandex.net said:
    552 5.2.2 <land7777@yandex.ru> Mailbox full (over quota)
    (in reply to RCPT TO command)

<baranova-1962@mail.ru>: host mxsrv.mail.ru said:
    451 4.3.0 Requested action aborted: try again later
    (in reply to RCPT TO command)

<24mpe@mail.ru>: host mx.freemail.ru said:
    550 5.1.1 Recipient address rejected: User unknown
    (in reply to RCPT TO command)

From: Danila <teivrim21@gmail.com>
To: land7777@yandex.ru
Subject: =?utf-8?B?0KHQsNC50YIg0LTQu9GPINC?=
'@
$o = Run-Scan $ya
Check 'переполненный ящик признан живым'    ($o -match 'land7777@yandex\.ru\s+alive')    ($o -split "`n" | Where-Object { $_ -match 'land7777' }) -join ' | '
Check 'переполненный НЕ помечен мёртвым'   ($o -notmatch 'land7777@yandex\.ru\s+dead')
Check 'отложенный признан повтором'         ($o -match 'baranova-1962@mail\.ru\s+retry') ($o -split "`n" | Where-Object { $_ -match 'baranova' }) -join ' | '
Check 'отложенный НЕ помечен мёртвым'      ($o -notmatch 'baranova-1962@mail\.ru\s+dead')
Check 'User unknown помечен мёртвым'        ($o -match '24mpe@mail\.ru\s+dead')
Check 'найден ровно один мёртвый'           ($o -match 'мёртвых: 1')                     ($o -split "`n" | Where-Object { $_ -match 'мёртвых:' }) -join ' | '
Check 'свой адрес не попал в разбор'        ($o -notmatch 'teivrim21@gmail\.com\s+(dead|alive|retry)')

# --- 2. отказ Google: единственный настоящий отказ ---
$gg = @'
Delivery to the following recipients failed permanently.

  aspmk@astranet.ru
    The email account that you tried to reach does not exist. 550 5.1.1
    Recipient address rejected: User unknown

--- Original message
From: Danila <teivrim21@gmail.com>
To: aspmk@astranet.ru
Subject: =?utf-8?B?0KHQsNC50YIg0LTQu9GPINC?=
'@
$o = Run-Scan $gg
Check 'отказ Google разобран'                ($o -match 'aspmk@astranet\.ru\s+dead')      ($o -split "`n" | Where-Object { $_ -match 'aspmk' }) -join ' | '
Check 'в отказе Google ровно один адрес'     ($o -match 'найдено адресов 1')               ($o -split "`n" | Where-Object { $_ -match 'найдено адресов' }) -join ' | '

# --- 3. ящик отключён: это смерть, в отличие от переполнения ---
$dis = @'
<test@example.com>: host mx.example.com said: 550 5.7.1 Message rejected
'@
$o = Run-Scan $dis
Check '5.7.1 = мёртвый адрес'                ($o -match 'test@example\.com\s+dead')      ($o -split "`n" | Where-Object { $_ -match 'example' }) -join ' | '

# --- 4. в тексте нет адресов: честная ошибка, а не тихий успех ---
$o = Run-Scan 'это просто письмо без отказа доставки'
Check 'без адресов выходит понятная ошибка'  ($o -match 'адресов в тексте отказа не найдено')

# --- 5. боевые файлы не тронуты ---
$dbAfter = (Get-Item $dbPath -ErrorAction SilentlyContinue).LastWriteTimeUtc
$deadAfter = (Get-Item $deadPath -ErrorAction SilentlyContinue).LastWriteTimeUtc
$deadCountAfter = @(Import-Csv $deadPath -ErrorAction SilentlyContinue).Count
Check 'deals.csv не изменён прогоном'        ($dbBefore -eq $dbAfter) ("было {0}, стало {1}" -f $dbBefore, $dbAfter)
Check 'dead-addresses.csv не изменён'        ($deadBefore -eq $deadAfter -and $deadCountBefore -eq $deadCountAfter) ("{0} -> {1} строк" -f $deadCountBefore, $deadCountAfter)

Write-Host ''
Write-Host ("ИТОГО: pass={0} fail={1}" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }