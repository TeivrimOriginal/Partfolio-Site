<#
  test-target-picker.ps1 — проверяет, что выборка карточек бьёт по нужным регионам
  и что цели не липнут к началу списка.

  Зачем. Выборка была равномерной по всему реестру, а реестр отсортирован по ОГРН,
  то есть по региону. Замеренный состав шарда 0055 (49 999 URL):
    77 Москва 33.9% · 78 СПб 21.1% · вместе с 50 Московская обл. 63.3%
  Это крупные компании, у которых сайт есть почти всегда, поэтому выходило
  6 лидов на 29 страниц. Плюс цикл выбора начинался с индекса 0, то есть смещение
  было не просто статистическим, а систематическим.

  Проверяем на локальном шарде, без обращений к сети.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pass = 0; $fail = 0
$doneSet = @{}
$fails = New-Object System.Collections.ArrayList
# Консоль Windows портит кириллицу, поэтому падения пишем ещё и в UTF-8 файл:
# иначе в логе видно только обрывок слова и непонятно, что именно упало.
$diagFile = Join-Path $root 'target-picker-fails.txt'
if (Test-Path $diagFile) { Remove-Item $diagFile -Force }
function Check { param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else {
    $script:fail++; Write-Host "  FAIL  $N  $D"
    [void]$script:fails.Add(($N + '  ||  ' + $D))
  }
}

$shard = $null
foreach ($cand in @('_smcache\0055.xml', '_smcache\0001.xml', '_smcache\0008.xml')) {
  $p = Join-Path $root $cand
  if (Test-Path $p) { $shard = $p; break }
}
Check 'локальный шард карты найден' ($null -ne $shard) 'скачать карту нечем, тест не выполним'

if ($shard) {
  $all = @([IO.File]::ReadAllText($shard) -split "`r?`n" | Where-Object { $_ })
  Check 'шард непустой' ($all.Count -gt 1000) ("url=" + $all.Count)

  # разбор ОГРН из URL: 1 | ГГ | РР | счётчик | контрольная
  $rx = [regex]'-(\d{13})(?:\s|$)'
  $m = $rx.Match($all[0])
  Check 'в URL есть 13-значный ОГРН' ($m.Success) $all[0]
  if ($m.Success) {
    $id = $m.Groups[1].Value
    Check 'год регистрации читается' (($id.Substring(1,2) -match '^\d{2}$')) $id.Substring(1,2)
    Check 'код региона читается' ($id.Substring(3,2) -match '^\d{2}$') $id.Substring(3,2)
  }

  # тот же отбор, что в build-noweb-base.ps1
  $ex = @('77', '78', '50')
  $pool = New-Object System.Collections.ArrayList
  foreach ($x in $all) {
    $mm = $rx.Match($x)
    if (-not $mm.Success) { continue }
    $reg = $mm.Groups[1].Value.Substring(3, 2)
    if ($ex -contains $reg) { continue }
    [void]$pool.Add($x)
  }
  Check 'отсев по регионам оставил пул' ($pool.Count -gt 1000) ("pool=" + $pool.Count)
  Check 'отсев убрал ощутимую долю' ($pool.Count -lt $all.Count * 0.75) ("pool=" + $pool.Count + " из " + $all.Count)

  # в пуле не должно быть столичных регионов
  $bad = 0
  foreach ($x in $pool) { if ($ex -contains $rx.Match($x).Groups[1].Value.Substring(3, 2)) { $bad++ } }
  Check 'в пуле нет исключённых регионов' ($bad -eq 0) ("найдено " + $bad)

  # цели должны быть разбросаны по всему пулу, а не браться с начала
  $Pages = 50
  $stride = $pool.Count / [double]$Pages
  $targets = @()
  for ($k = 0; $k -lt $Pages; $k++) { $targets += $pool[[int][Math]::Floor($k * $stride)] }
  Check 'набрано нужное число целей' ($targets.Count -eq $Pages) ("targets=" + $targets.Count)
  Check 'цели охватывают хвост пула' ($targets[-1] -gt $pool[[int]($pool.Count / 2)]) "последняя цель слишком близко к началу"
  # разброс: последняя взятая позиция должна быть близка к концу пула.
  # Считаем индексы арифметикой, а не через IndexOf: IndexOf для URL-строк
  # зависит от типа коллекции и молча даёт -1 при несовпадении.
  $lastIx = [int][Math]::Floor(($Pages - 1) * $stride)
  $threshold = [int]($pool.Count * 0.9)
  Check 'spread' ($lastIx -gt $threshold) ('last={0} thr={1} pool={2}' -f $lastIx, $threshold, $pool.Count)

  # ВОЗОБНОВЛЕНИЕ. Порядок должен быть: полный пул минус собранное, потом выборка.
  # Если сначала выбрать $Pages целей, а потом выбросить собранные, батч с каждым
  # разом сдувается. Проверяем на трёх последовательных прогонах.
  $sim = New-Object System.Collections.ArrayList
  foreach ($x in $pool) { [void]$sim.Add($x) }
  $batchSizes = @()
  for ($run = 1; $run -le 3; $run++) {
    $rem = New-Object System.Collections.ArrayList
    foreach ($x in $sim) { if (-not $doneSet.ContainsKey($x)) { [void]$rem.Add($x) } }
    if ($rem.Count -le $Pages) {
      $pickNow = @($rem)
    } else {
      $st = $rem.Count / [double]$Pages
      $pickNow = @()
      for ($k = 0; $k -lt $Pages; $k++) { $pickNow += $rem[[int][Math]::Floor($k * $st)] }
    }
    $batchSizes += $pickNow.Count
    foreach ($u in $pickNow) { $doneSet[$u] = $true }
  }
  Check 'каждый батч полный, а не сдувается' (($batchSizes | Where-Object { $_ -ne 50 }).Count -eq 0) ('размеры: ' + ($batchSizes -join ', '))

  $regs = @{}
  foreach ($u in $targets) { $r = $rx.Match($u).Groups[1].Value.Substring(3, 2); if ($regs.ContainsKey($r)) { $regs[$r]++ } else { $regs[$r] = 1 } }
  Check 'цели охватывают много регионов' ($regs.Count -ge 8) ("регионов=" + $regs.Count)

  # главная проверка: ноль столичных среди целей
  $metroIn = 0
  foreach ($r in $regs.Keys) { if ($ex -contains $r) { $metroIn += $regs[$r] } }
  Check 'среди целей НЕТ Москвы, СПб и Мос обл.' ($metroIn -eq 0) ("столичных целей=" + $metroIn)

  # в коде сборщика не должно остаться старого отбора с индекса 0
  $src = [IO.File]::ReadAllText((Join-Path $root 'build-noweb-base.ps1'), [Text.Encoding]::UTF8)
  Check 'в сборщике есть отсев по регионам' ($src -match '\$ExcludeRegions')
  # Выборка идёт по $remaining (пул минус уже собранное), а не по $urlPool:
  # сначала выбрать, потом отбросить собранное — батч сдувается.
  Check 'в сборщике разбрасывание идёт по $remaining' ($src -match '\$remaining\[\[int\]\[Math\]::Floor')
  Check 'в сборщике $remaining — это пул минус собранное' ($src -match '\$remaining\.Add\(\$x\)\s*\}' -or $src -match 'if \(-not \$done\.ContainsKey\(\$x\)\)')
  Check 'ShardSpan по умолчанию 1, а не 10' ($src -match '\[int\]\$ShardSpan\s*=\s*1,')
  Check 'старый цикл с $i = 0 больше не выбирает цели' (-not ($src -match 'for \(\$i = 0; \$i -lt \$all\.Count'))
  # выбирать цели ДО отсева собранного больше нельзя
  Check 'цели строятся после отсева собранного' (-not ($src -match '\$targets = @\(\$targets \| Where-Object'))

  # коллектор не должен требовать 10 шардов
  $col = [IO.File]::ReadAllText((Join-Path $root 'collector.ps1'), [Text.Encoding]::UTF8)
  Check 'коллектор просит 1 шард, а не 10' (($col -match '-ShardSpan 1') -and (-not ($col -match '-ShardSpan 10')))
}

Write-Host ''
if ($fails.Count -gt 0) {
  [IO.File]::WriteAllLines($diagFile, $fails.ToArray(), (New-Object Text.UTF8Encoding $false))
  Write-Host ("fails written to: " + (Split-Path $diagFile -Leaf)) -ForegroundColor Yellow
}
Write-Host ("ИТОГО: pass={0} fail={1}" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }