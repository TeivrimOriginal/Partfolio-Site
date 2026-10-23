<#
  test-pipeline.ps1 - проверка гейтов воронки. Запуск: powershell -File test-pipeline.ps1
  Гейты — это то, что не даёт отдать клиенту макет и сайт бесплатно, поэтому
  каждый блокирующий сценарий проверяется отдельным ассертом.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pl = Join-Path $root 'pipeline.ps1'
$tmp = Join-Path $root 'deals-test.csv'
$pass = 0; $fail = 0

function Invoke-Pipeline {
  param([string[]]$PipeArgs)
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $pl @PipeArgs 2>&1
  return [pscustomobject]@{ code = $LASTEXITCODE; text = ($out | Out-String) }
}

function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:pass++; Write-Host ("  PASS  {0}" -f $Name) -ForegroundColor Green }
  else { $script:fail++; Write-Host ("  FAIL  {0}  {1}" -f $Name, $Detail) -ForegroundColor Red }
}

Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Write-Host '=== гейты воронки ==='

$r = Invoke-Pipeline @('init', '-File', $tmp)
Check 'init создаёт доску' ($r.code -eq 0 -and (Test-Path $tmp)) $r.text

$r = Invoke-Pipeline @('add', '-File', $tmp, '-Top', '5')
Check 'add заливает лиды из базы' ($r.code -eq 0 -and $r.text -match 'added [1-9]') $r.text

$rows = @(Import-Csv $tmp)
Check 'лиды получили этап a1' ($rows.Count -gt 0 -and $rows[0].stage -eq 'a1') ("rows=" + $rows.Count)

# нормальное движение
$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'a2')
Check 'a1 -> a2 проходит' ($r.code -eq 0 -and $r.text -match 'a2') $r.text

# главный гейт: нельзя начать работу без предоплаты
$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'b4')
Check 'a2 -> b4 БЕЗ суммы блокируется' ($r.code -eq 2 -and $r.text -match 'не указана сумма') $r.text

$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'b4', '-Value', '35000', '-Prepay', '10000')
Check 'предоплата меньше 50% блокируется' ($r.code -eq 2 -and $r.text -match 'предоплата меньше 50') $r.text

$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'b4', '-Value', '35000', '-Prepay', '17500')
Check 'предоплата 50% пропускает' ($r.code -eq 0) $r.text

$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'b5')
Check 'b4 -> b5 (сборка) проходит' ($r.code -eq 0) $r.text

$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'b7', '-Paid', '17500')
Check 'финал без полной оплаты блокируется' ($r.code -eq 2 -and $r.text -match 'оплачено меньше суммы') $r.text

$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'b7', '-Paid', '35000', '-Next', 'чек-ин 30 дней')
Check 'финал с полной оплатой проходит' ($r.code -eq 0) $r.text

# назад нельзя
$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'a3')
Check 'переход назад блокируется' ($r.code -eq 2 -and $r.text -match 'назад') $r.text

# деньги не пересчитываются молча
$after = @(Import-Csv $tmp | Where-Object { $_.id -eq $rows[0].id })[0]
Check 'сумма и оплата записаны' ([int]$after.value_rub -eq 35000 -and [int]$after.paid_rub -eq 35000) ("v=" + $after.value_rub + " p=" + $after.paid_rub)
Check 'чек-ин назначен' ($after.next_action_date -ne '') $after.next_action_date

# дубликаты не плодятся
$before = @(Import-Csv $tmp).Count
$r = Invoke-Pipeline @('add', '-File', $tmp, '-Top', '5')
$after2 = @(Import-Csv $tmp).Count
Check 'повторный add не создаёт дублей' ($after2 -eq $before) ("$before -> $after2")

# due отдаёт задачи
$r = Invoke-Pipeline @('due', '-File', $tmp)
Check 'due отвечает без ошибок' ($r.code -eq 0) $r.text

$r = Invoke-Pipeline @('stats', '-File', $tmp)
Check 'stats отвечает без ошибок' ($r.code -eq 0 -and $r.text -match 'воронка') $r.text

# отказ доставки: сделку можно остановить из ЛЮБОГО этапа, это не продвижение
$tmpDead = [IO.Path]::ChangeExtension($tmp, '.dead.csv')
$r = Invoke-Pipeline @('bounce', '-File', $tmp, '-DeadFile', $tmpDead, '-Id', $rows[0].id, '-Next', '550 5.1.1 User unknown')
Check 'bounce проходит из любого этапа' ($r.code -eq 0 -and $r.text -match 'не существует') $r.text
Check 'тест не пишет в боевой dead-addresses.csv' ($r.code -eq 0) 'путь изолирован параметром'

$z = @(Import-Csv $tmp | Where-Object { $_.id -eq $rows[0].id })[0]
Check 'этап стал z1' ($z.stage -eq 'z1') $z.stage
Check 'у z1 нет следующего действия' ($z.next_action_date -eq '' -and $z.next_action -eq '') ("'" + $z.next_action_date + "'")

# из z1 больше нельзя выйти в b-этапы: адреса нет, договариваться некому
$r = Invoke-Pipeline @('stage', '-File', $tmp, '-Id', $rows[0].id, '-To', 'b1')
Check 'из z1 в воронку продаж не пускает' ($r.code -eq 2) $r.text

# неизвестный id должен падать, а не молча создавать запись
$r = Invoke-Pipeline @('bounce', '-File', $tmp, '-DeadFile', $tmpDead, '-Id', 'dXXX', '-Next', '550')
Check 'bounce по несуществующему id падает' ($r.code -ne 0) $r.text

# повторный bounce того же адреса не должен плодить дубли. На боевом файле
# 24mpe@mail.ru записался дважды (03.10 и 04.10), и "всего там: 3" при двух
# мёртвых адресах. Повтор баунса будет постоянным: автопрогон шлёт follow-up
# всем подряд, в том числе уже терминированным ящикам.
$deadAfterFirst = @(Import-Csv $tmpDead)
$z1 = @(Import-Csv $tmp | Where-Object { $_.id -eq $rows[0].id })[0]
$r = Invoke-Pipeline @('bounce', '-File', $tmp, '-DeadFile', $tmpDead, '-Id', $rows[0].id, '-Next', '550 повтор')
$deadAfterSecond = @(Import-Csv $tmpDead)
Check 'повторный bounce не добавляет дубль' ($deadAfterSecond.Count -eq $deadAfterFirst.Count) ("было=" + $deadAfterFirst.Count + " стало=" + $deadAfterSecond.Count)
Check 'повторный bounce обновляет метку времени' ($deadAfterSecond[0].bounced_at -notmatch '^\d{4}-\d{2}-\d{2} 00:00:00') $deadAfterSecond[0].bounced_at
Check 'повторный bounce пишет новый код SMTP' ($deadAfterSecond[0].smtp -eq '550 повтор') $deadAfterSecond[0].smtp
Check 'число мёртвых адресов в выводе совпадает с файлом' ($r.text -match ('всего там: ' + $deadAfterSecond.Count)) $r.text

Remove-Item $tmpDead -Force -ErrorAction SilentlyContinue

Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host ("ИТОГО: pass={0} fail={1}" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }
