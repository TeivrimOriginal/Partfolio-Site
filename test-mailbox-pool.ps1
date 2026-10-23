<#
  test-mailbox-pool.ps1 — юнит-тест ротации ящиков. Без сети, без паролей.

  Что проверяем (каждый пункт — реальная ошибка, которая уже стоила бы писем):
    1. пул импортируется из CSV, дневные лимиты читаются
    2. лимит из аргумента -MaxPerDay перекрывает лимит в файле
    3. ротация идёт по кругу, а не «сначала весь ящик1»
    4. ящик с исчерпанным лимитом выпадает из ротации
    5. когда лимиты исчерпаны у всех — Select-Sender возвращает причину, а не $null молча
    6. битый CSV (пустой pass_env, несуществующая переменная, port как текст,
       нулевой лимит) валит импорт, а не проходит молча
    7. Get-SenderUsage считает сегодняшние отправки по sent-log.csv и не считает
       чужие дни и не-sent статусы
    8. пароль в пуле всегда из окружения, в CSV его нет

  Тест пишет временный CSV в %TEMP% и сносит его за собой.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
. (Join-Path $root 'mailbox-pool.ps1')

$pass = 0; $fail = 0
$fails = New-Object System.Collections.ArrayList
$diagFile = Join-Path $root 'mailbox-pool-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check {
  param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

$tmp = Join-Path $env:TEMP ('mpool-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$csv = Join-Path $tmp 'mailboxes.csv'
$log = Join-Path $tmp 'sent-log.csv'

# окружение для теста: пароли в тесте настоящие не нужны и не должны быть
$env:MAIL_PASS_T1 = 'test-only-1'
$env:MAIL_PASS_T2 = 'test-only-2'
$env:MAIL_PASS_T3 = 'test-only-3'

@'
name,user,host,port,daily_limit,pass_env,display_name
box1,t1@domen.ru,smtp.yandex.ru,587,3,MAIL_PASS_T1,Данила Арсеньев
box2,t2@domen.ru,smtp.yandex.ru,587,3,MAIL_PASS_T2,Данила Арсеньев
box3,t3@domen.ru,smtp.yandex.ru,587,2,MAIL_PASS_T3,Данила Арсеньев
'@ | Set-Content -Path $csv -Encoding UTF8

Write-Host '=== mailbox-pool ==='

# --- 1. импорт ---
$pool = $null
try { $pool = Import-SenderPool -Path $csv } catch { Check 'пул импортируется' $false $_.Exception.Message }
Check 'пул импортируется' ($null -ne $pool -and @($pool).Count -eq 3) ("count=" + @($pool).Count)
Check 'лимиты прочитаны' ($pool[2].daily_limit -eq 2) ("box3 limit=" + $pool[2].daily_limit)
Check 'хост и порт прочитаны' ($pool[0].host -eq 'smtp.yandex.ru' -and $pool[0].port -eq 587) ("$($pool[0].host):$($pool[0].port)")
Check 'display_name прочитан' ($pool[0].display_name -eq 'Данила Арсеньев') $pool[0].display_name

# --- 2. перекрытие лимита аргументом ---
$poolCap = Import-SenderPool -Path $csv -MaxPerDay 1
Check '-MaxPerDay перекрывает лимит файла' ($poolCap[2].daily_limit -eq 1) ("box3 limit=" + $poolCap[2].daily_limit)

# --- 3. ротация по кругу ---
$usage = @{ 't1@domen.ru' = 0; 't2@domen.ru' = 0; 't3@domen.ru' = 0 }
$cursor = 0; $seq = @()
for ($i = 0; $i -lt 6; $i++) {
  $pick = Select-Sender -Pool $pool -Usage $usage -Cursor $cursor
  if ($null -eq $pick.sender) { break }
  $cursor = $pick.cursor
  $seq += $pick.sender.name
  $usage[$pick.sender.user] = [int]$usage[$pick.sender.user] + 1
}
Check 'ротация идёт по кругу' (($seq -join ',') -eq 'box1,box2,box3,box1,box2,box3') ($seq -join ',')
Check 'лимит box3=2 соблюдён' (($seq | Where-Object { $_ -eq 'box3' }).Count -eq 2) ($seq -join ',')

# --- 4. исчерпанный ящик выпадает ---
$usage2 = @{ 't1@domen.ru' = 3; 't2@domen.ru' = 0; 't3@domen.ru' = 2 }
$p1 = Select-Sender -Pool $pool -Usage $usage2 -Cursor 0
Check 'исчерпанный ящик выпадает из ротации' ($null -ne $p1.sender -and $p1.sender.name -eq 'box2') ("got=" + $p1.sender.name)

# --- 5. все лимиты исчерпаны -> причина, а не тишина ---
$usage3 = @{ 't1@domen.ru' = 3; 't2@domen.ru' = 3; 't3@domen.ru' = 2 }
$p2 = Select-Sender -Pool $pool -Usage $usage3 -Cursor 0
Check 'при исчерпанных лимитах sender пуст' ($null -eq $p2.sender) 'sender не должен быть'
Check 'при исчерпанных лимитах есть причина' ($p2.reason -match 'исчерпан') $p2.reason

# --- 6. битый CSV ---
$bad = Join-Path $tmp 'bad.csv'
'user,host,port,daily_limit,pass_env' | Set-Content -Path $bad -Encoding UTF8
'x@domen.ru,smtp.yandex.ru,587,10,' | Add-Content -Path $bad -Encoding UTF8
$err = ''
try { $null = Import-SenderPool -Path $bad } catch { $err = $_.Exception.Message }
Check 'пустой pass_env валит импорт' ($err -match 'pass_env') $err

'user,host,port,daily_limit,pass_env' | Set-Content -Path $bad -Encoding UTF8
'x@domen.ru,smtp.yandex.ru,587,10,MAIL_PASS_NOPE' | Add-Content -Path $bad -Encoding UTF8
$err = ''
try { $null = Import-SenderPool -Path $bad } catch { $err = $_.Exception.Message }
Check 'несуществующая переменная с паролем валит импорт' ($err -match 'MAIL_PASS_NOPE') $err

'user,host,port,daily_limit,pass_env' | Set-Content -Path $bad -Encoding UTF8
'x@domen.ru,smtp.yandex.ru,нет,10,MAIL_PASS_T1' | Add-Content -Path $bad -Encoding UTF8
$err = ''
try { $null = Import-SenderPool -Path $bad } catch { $err = $_.Exception.Message }
Check 'нечисловой порт валит импорт' ($err -match 'port') $err

'user,host,port,daily_limit,pass_env' | Set-Content -Path $bad -Encoding UTF8
'x@domen.ru,smtp.yandex.ru,587,0,MAIL_PASS_T1' | Add-Content -Path $bad -Encoding UTF8
$err = ''
try { $null = Import-SenderPool -Path $bad } catch { $err = $_.Exception.Message }
Check 'нулевой дневной лимит валит импорт' ($err -match 'больше нуля') $err

$err = ''
try { $null = Import-SenderPool -Path (Join-Path $tmp 'net-takogo.csv') } catch { $err = $_.Exception.Message }
Check 'отсутствующий файл пула валит импорт' ($err -match 'не найден') $err

# --- 7. учёт отправок за сегодня ---
$today = Get-Date -Format 'yyyy-MM-dd'
$yest = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
# строки лога собираем строками: массив из токенов Set-Content записал бы
# по одному токену на строку, и Import-Csv получил бы 15 «строк» вместо 5.
$hdr = @('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach', 'from') -join ','
$logLines = @($hdr
  "e1,a@domen.ru,A,s,$today 10:00:00,sent,,,t1@domen.ru"
  "e2,b@domen.ru,B,s,$today 11:00:00,failed,boom,,,t1@domen.ru"
  "e3,c@domen.ru,C,s,$today 12:00:00,sent-mistake,промах,,t1@domen.ru"
  "e4,d@domen.ru,D,s,$yest 12:00:00,sent,,,t1@domen.ru"
  "e5,e@domen.ru,E,s,$today 13:00:00,sent,,,t2@domen.ru")
$logLines | Set-Content -Path $log -Encoding UTF8
$hdrCols = @((Import-Csv -Path $log -Encoding UTF8)[0].PSObject.Properties.Name).Count
$u = Get-SenderUsage -Pool $pool -SentLog $log -Date $today
Check 'тестовый лог собран верно (9 колонок в каждой строке)' ($hdrCols -eq 9 -and @((Import-Csv -Path $log -Encoding UTF8)).Count -eq 5) ("cols=$hdrCols rows=" + @((Import-Csv -Path $log -Encoding UTF8)).Count)
Check 'usage: sent и sent-mistake за сегодня считаются' ($u['t1@domen.ru'] -eq 2) ("t1=" + $u['t1@domen.ru'])
Check 'usage: failed не считается' ($u['t2@domen.ru'] -eq 1) ("t2=" + $u['t2@domen.ru'])
Check 'usage: вчерашние отправки не считаются' ($u['t3@domen.ru'] -eq 0) ("t3=" + $u['t3@domen.ru'])

# лог без колонки from (старый формат) не должен ломать учёт
@(
  (@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach') -join ',')
  "f1,f@domen.ru,F,s,$today 09:00:00,sent,,"
) | Set-Content -Path $log -Encoding UTF8
$err = ''
$u2 = $null
try { $u2 = Get-SenderUsage -Pool $pool -SentLog $log -Date $today } catch { $err = $_.Exception.Message }
Check 'старый лог без колонки from не роняет учёт' ([string]::IsNullOrEmpty($err) -and $null -ne $u2) $err

# --- 8. секретов в CSV нет ---
$raw = Get-Content -Path $csv -Raw
Check 'пароля в CSV нет' (-not ($raw -match 'test-only-')) 'в файле пула найден пароль'
Check 'пароль взят из окружения' ($pool[0].pass -eq 'test-only-1') 'пароль не подхватился из переменной'

# --- кэш клиентов по ящику ---
$cache = @{}
$c1 = Get-SenderClient -Cache $cache -Sender $pool[0]
$c1b = Get-SenderClient -Cache $cache -Sender $pool[0]
$c2 = Get-SenderClient -Cache $cache -Sender $pool[1]
Check 'клиент кэшируется по ящику' ([object]::ReferenceEquals($c1, $c1b) -and -not [object]::ReferenceEquals($c1, $c2)) 'кэш клиентов не работает'
$c1.Dispose(); $c2.Dispose()

# --- приведение sent-log.csv к схеме с колонкой from ---
$legacy = Join-Path $tmp 'sent-legacy.csv'
@(
  (@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach') -join ',')
  'g1,h@domen.ru,"ООО Ромашка, Inc",s,"2026-10-01 09:00:00",sent,,'
) | Set-Content -Path $legacy -Encoding UTF8
$mig = Ensure-SentLogSchema -Path $legacy
Check 'миграция лога отмечает изменение' ($mig.changed -eq $true -and $mig.rows -eq 1) ("changed=" + $mig.changed + " rows=" + $mig.rows)
Check 'миграция лога делает резервную копию' ((Test-Path $mig.backup) -and $mig.backup -like '*.bak-*') $mig.backup
$migRows = @(Import-Csv -Path $legacy -Encoding UTF8)
Check 'после миграции в логе есть колонка from' (@($migRows[0].PSObject.Properties.Name) -contains 'from') (@($migRows[0].PSObject.Properties.Name) -join ',')
Check 'данные лога пережили миграцию' ($migRows[0].to -eq 'h@domen.ru' -and $migRows[0].company -eq 'ООО Ромашка, Inc' -and $migRows[0].status -eq 'sent') ("to=" + $migRows[0].to + " company=" + $migRows[0].company)
Check 'from в старых строках пуст' ($migRows[0].from -eq '') ("from=[" + $migRows[0].from + "]")
$mig2 = Ensure-SentLogSchema -Path $legacy
Check 'повторная миграция ничего не делает' ($mig2.changed -eq $false) ("changed=" + $mig2.changed)
Check 'повторная миграция не плодит копии' (@(Get-ChildItem (Join-Path $tmp 'sent-legacy.csv.bak-*')).Count -eq 1) 'бэкапов больше одного'
$newLog = Join-Path $tmp 'sent-new.csv'
$mig3 = Ensure-SentLogSchema -Path $newLog
Check 'лог без колонки from создаётся' ($mig3.changed -eq $true -and @(Import-Csv -Path $newLog -Encoding UTF8).Count -eq 0) 'пустой лог не создан'

# Export-Csv -Append НЕ расширяет шапку — это и есть причина миграции
$hdrNoFrom = ($newLog)
@('id', 'to', 'company', 'subject', 'sent_at', 'status', 'error', 'attach') | Set-Content -Path $hdrNoFrom -Encoding UTF8
[pscustomobject]@{ id = 'z'; to = 'z@domen.ru'; status = 'sent'; from = 't1@domen.ru' } |
  Export-Csv -Path $hdrNoFrom -NoTypeInformation -Encoding UTF8 -Append -Force
$lostFrom = @(Import-Csv -Path $hdrNoFrom -Encoding UTF8)[0]
Check 'Export-Csv -Append теряет from без миграции' (-not (@($lostFrom.PSObject.Properties.Name) -contains 'from')) 'ожидалось, что колонка потеряется'

# --- пул длиной 1 для одиночного ящика ---
$one = New-SingleSender -User 'solo@domen.ru' -Pass 'x' -Host_ 'smtp.yandex.ru' -Port 587 -DailyLimit 5
$uOne = Get-SenderUsage -Pool @($one) -SentLog ''
$pOne = Select-Sender -Pool @($one) -Usage $uOne -Cursor 0
Check 'одиночный ящик работает как пул' ($pOne.sender.user -eq 'solo@domen.ru') 'picking failed'

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
foreach ($v in 'MAIL_PASS_T1', 'MAIL_PASS_T2', 'MAIL_PASS_T3') {
  Remove-Item "env:$v" -ErrorAction SilentlyContinue
}

Write-Host ''
if ($fail -gt 0) {
  $fails -join "`r`n" | Set-Content -Path $diagFile -Encoding UTF8
  Write-Host ("FAIL {0} / PASS {1}  (подробности: {2})" -f $fail, $pass, $diagFile)
  exit 1
}
Write-Host ("PASS {0}" -f $pass)
exit 0
