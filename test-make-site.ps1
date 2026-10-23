<#
  test-make-site.ps1 — проверяет, что поставляемый сайт боевой, а не недоделанный
  пример, и что форма заявки не выглядит рабочей, отправляя заявку в никуда.

  Почему этот тест. При сборке боевого сайта нашлись три молчаливые поломки, и
  все три выглядели бы как готовый продукт:
    1. форма подменялась целиком — страница содержала пустую форму без полей,
       которая выглядит рабочей и никуда не отправляет;
    2. «mailto:$email?subject=» в PowerShell — это ОДНО имя переменной (знак ?
       допустим в именах), поэтому получался «mailto:=»: почта открывалась без
       адресата, все заявки пропадали;
    3. CSS-правила .demo-banner оставались в файле, потому что «\s*» в конце
       регулярки съедал перевод строки и якорь (?m)^ переставал срабатывать.
  Ни одну из них не видно глазами в готовом файле — видно только на проверках.
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$pass = 0; $fail = 0
function Check { param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else { $script:fail++; Write-Host "  FAIL  $N  $D" }
}

$maker = Join-Path $root 'make-site.ps1'
Check 'сборщик боевого сайта существует' (Test-Path $maker) $maker

# собираем во временную папку, боевые сайты не трогаем
$tmpDir = Join-Path $root '_tsite'
$r = & powershell -NoProfile -ExecutionPolicy Bypass -File $maker -Id d003 -OutRoot '_tsite' 2>&1 | Out-String
$site = Join-Path $tmpDir 'd003\index.html'
Check 'сайт собран' (Test-Path $site) ($r -split "`n" | Select-Object -First 3) -join ' | '

if (Test-Path $site) {
  $h = [IO.File]::ReadAllText($site, [Text.Encoding]::UTF8)
  $deal = @(Import-Csv (Join-Path $root 'deals.csv') | Where-Object { $_.id -eq 'd003' })[0]

  # --- это должен быть БОЕВОЙ сайт, а не пример ---
  Check 'нет надписи ЭТО ПРИМЕР'        (-not ($h -match 'ЭТО ПРИМЕР')) 'найдено'
  Check 'нет блоков demo-banner/demo-foot' (-not ($h -match 'demo-banner|demo-foot'))
  Check 'нет CSS-правил .demo-*'        (-not ($h -match '\.demo-')) 'остались мёртвые стили'
  Check 'нет слов «Демонстрационный/демо»' (-not ($h -match 'Демонстрационн|демо'))
  Check 'в <title> нет слова «пример»'  (-not ($h -match '<title>[^<]*пример'))
  Check 'комментарий про пример удалён'  (-not ($h -match '<!--[^>]*ПРИМЕР'))

  # --- данные настоящие ---
  Check 'есть название компании'         ($h -match [regex]::Escape(($deal.company -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;' -replace '"','&quot;'))) 'нет'
  Check 'есть телефон'                   ($h -match [regex]::Escape($deal.phone)) 'нет'
  Check 'телефон кликабельный tel:'      ($h -match 'tel:\+\d{11}')
  Check 'есть почта'                     ($h -match [regex]::Escape($deal.email)) 'нет'
  Check 'есть город'                     ($h -match [regex]::Escape($deal.city)) 'нет'

  # --- главное: никаких выдуманных цен ---
  $prices = @([regex]::Matches($h, '<span class="price">([^<]*)</span>') | ForEach-Object { $_.Groups[1].Value.Trim() })
  Check 'блок цен не пуст'               ($prices.Count -gt 0) 'нет блока цен'
  Check 'цены НЕ выдуманы'               (@($prices | Where-Object { $_ -match '\d' }).Count -eq 0) ($prices -join ', ')
  Check 'цены просят уточнить'           (@($prices | Where-Object { $_ -match 'уточняйте' }).Count -eq $prices.Count) ($prices -join ', ')

  # --- форма: поля на месте и адресат есть ---
  foreach ($f in @('name="name"', 'name="phone"', 'name="service"', 'name="message"', 'type="submit"', 'class="ok"')) {
    Check "в форме есть поле $f" ($h.Contains($f))
  }
  Check 'форма НЕ mailto без адреса'     (-not ($h -match 'mailto:=')) 'заявки уходят в никуда'
  Check 'форма пишет на почту компании'  ($h -match ('mailto:' + [regex]::Escape($deal.email) + '\?subject=')) 'нет'
  Check 'форма собирает поля письма'     ($h -match "this\.name\.value" -and $h -match "this\.phone\.value")
  Check 'форма показывает отправку'      ($h -match "querySelector\('\.ok'\)\.hidden=false")

  # --- честность подписи под формой ---
  Check 'под формой нет «демонстрационной»' (-not ($h -match 'демонстрационная форма'))

  # --- плейсхолдеров быть не должно ---
  $ph = @([regex]::Matches($h, '\{\{[A-Z0-9_]+\}\}') | ForEach-Object { $_.Value } | Sort-Object -Unique)
  Check 'плейсхолдеров не осталось'       ($ph.Count -eq 0) ($ph -join ', ')

  # --- сайт должен открываться автономно ---
  Check 'нет внешних библиотек'          (-not ($h -match '<(script|link)[^>]*(src|href)="https?:')) 'есть внешние ресурсы'
  Check 'есть viewport для телефона'      ($h -match 'name="viewport"')
  Check 'есть lang ru'                    ($h -match 'lang="ru"')

  # --- инструкция для клиента ---
  Check 'инструкция КАК-ЗАПОЛНИТЬ создана' (Test-Path (Join-Path $tmpDir 'd003\КАК-ЗАПОЛНИТЬ.md'))
}

Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

# ---- СТРАХОВОЧНЫЕ УСЛОВИЯ ОБЯЗАНЫ РЕАЛЬНО СРАБАТЫВАТЬ ----
# Проверка «-not $html -match 'x'» в PowerShell вычисляется как
# «(-not $html) -match 'x'» и для непустой строки всегда даёт False, то есть
# условие не срабатывает НИКОГДА. Проверка выглядит живой, а ничего не проверяет.
# Такие пустышки опаснее отсутствия проверки: они создают ложную уверенность.
# Сейчас в проекте такая ошибка была одна — в make-site.ps1.
$src = [IO.File]::ReadAllText($maker, [Text.Encoding]::UTF8)
$badGuard = @([regex]::Matches($src, '(?m)^\s*if\s*\(\s*-not\s+\$\w+\s+-match\b') | ForEach-Object { $_.Value.Trim() })
Check 'в make-site.ps1 нет пустых -not X -match' ($badGuard.Count -eq 0) ($badGuard -join ' | ')

# и та же ошибка по всему проекту
$empty = @()
foreach ($f in (Get-ChildItem $root -Filter '*.ps1')) {
  $n = 0
  foreach ($line in [IO.File]::ReadAllLines($f.FullName)) {
    $n++
    if ($line -match '\(-not\s+[^\(\)\s]+\s+-match') { $empty += ('{0}:{1}' -f $f.Name, $n) }
  }
}
Check 'во всём проекте нет -not X -match без скобок' ($empty.Count -eq 0) ($empty -join ', ')

Write-Host ''
Write-Host ("ИТОГО: pass={0} fail={1}" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }