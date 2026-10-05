# Восстанавливает текст, записанный в двух кодировках подряд.
#
# Что найдено (измерено, не предположено):
#   APPLIED-LOG.md — 1373 символа U+FFFD и 1379 байт, не начинающих корректную
#   UTF-8 последовательность. Файл НЕ целиком UTF-8: куски записаны в
#   однобайтовой кириллической кодировке и вставлены в UTF-8-файл. Значит
#   повреждение обратимо: U+FFFD возникает при ДЕКОДИРОВАНИИ, байты целы.
#
# ГЛАВНОЕ, что стоило выяснить: однобайтовая кодировка здесь НЕ cp866, а
# cp1251. Измерено на одних и тех же байтах (около первой поломки):
#     байты: 23 23 20 20 ca e0 ef f7 e0 20 ee f2
#     cp866  → «╩ряўр юЄ»          (псевдографика, текста нет)
#     cp1251 → «Капча от»          (читаемый русский)
# Первая версия скрипта была написана на cp866 по умолчанию и давала «╩ряўр»:
#   U+FFFD становился нулём, и это выглядело как успешное восстановление.
#   Проверка «нуль замещающих символов» без проверки читаемости — ровно тот
#   случай, когда проверка проходит, ничего не проверяя.
#
# Почему кодировка выбирается, а не задаётся: в этом репозитории такие куски
# встречаются из разных источников, и угадывать нельзя. Для каждого файла
# пробуем набор кодировок и берём ту, где больше кириллических букв.
# Критерий проверяемый, а не вкусовой.
#
# Как собирается смешанный поток:
#   * байт 0x00-0x7F — одинаково в UTF-8 и в cp1251, берём как есть;
#   * 0xC0-0xFF, образующий валидную UTF-8 последовательность — читаем UTF-8;
#   * 0xC0-0xFF, не образующий UTF-8 — читаем однобайтовой кодировкой.
# Пробел и перевод строки ASCII между сломанными кусками остаются на месте.

param(
    [Parameter(Mandatory = $true)][string[]]$File,
    [switch]$DryRun
)

# Кандидаты: cp1251 (Windows-кириллица) и cp866 (OEM). KOI8-R не нужен:
# в этом репозитории файзы писались из Windows-консоли.
$CANDIDATES = @(1251, 866)

$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)

# Сколько подряд идущих байт образует одну последовательность UTF-8, начиная с $I.
#
# Имена переменных РАЗНЫЕ не только по регистру, но и по длине: $Bytes/$curByte,
# а не $B/$b. Причина, измеренная на этой же функции: переменные в PowerShell
# регистронезависимы, поэтому `$b = $B[$I]` присваивал байт параметру-массиву
# $B, и дальше `$B.Length` возвращал пустоту (у байта нет Length), а
# `$I + 1 -ge $null` истинно — функция выходила с нулём на ЛЮБОМ двухбайтовом
# символе. Симптом снаружи был обманчив: файл собирался без единого U+FFFD,
# то есть «восстановление проходило», а текст получался нечитаемым.
function Get-Utf8Len {
    param([byte[]]$Bytes, [int]$At)
    if ($At -ge $Bytes.Length) { return 0 }
    $cur = $Bytes[$At]
    if ($cur -lt 0x80) { return 1 }
    if ($At + 1 -ge $Bytes.Length) { return 0 }
    if (($cur -band 0xE0) -eq 0xC0) { $seqLen = 2 }
    elseif (($cur -band 0xF0) -eq 0xE0) { $seqLen = 3 }
    elseif (($cur -band 0xF8) -eq 0xF0) { $seqLen = 4 }
    else { return 0 }
    if ($At + $seqLen -gt $Bytes.Length) { return 0 }
    for ($n = 1; $n -lt $seqLen; $n++) { if (($Bytes[$At + $n] -band 0xC0) -ne 0x80) { return 0 } }
    return $seqLen
}

# Собирает строку из смешанного потока байтов в указанной однобайтовой кодировке.
function Convert-Mixed {
    param([byte[]]$Bytes, [System.Text.Encoding]$Single)
    $sb = New-Object System.Text.StringBuilder
    $i = 0
    while ($i -lt $Bytes.Length) {
        $l = Get-Utf8Len -Bytes $Bytes -At $i
        if ($l -ge 2) {
            # Максимальный подряд идущий валидный UTF-8 кусок
            $end = $i
            while ($end -lt $Bytes.Length) {
                $l2 = Get-Utf8Len -Bytes $Bytes -At $end
                if ($l2 -le 0) { break }
                $seg = New-Object byte[] $l2
                [Array]::Copy($Bytes, $end, $seg, 0, $l2)
                try { $null = $utf8Strict.GetString($seg) } catch { break }
                $end += $l2
            }
            [void]$sb.Append($utf8Strict.GetString($Bytes[$i..($end - 1)]))
            $i = $end
            continue
        }
        if ($l -eq 1) { [void]$sb.Append([char]$Bytes[$i]); $i++; continue }
        # Не-UTF-8: собираем подряд идущие такие байты и читаем однобайтово.
        $start = $i
        while ($i -lt $Bytes.Length) {
            $l3 = Get-Utf8Len -Bytes $Bytes -At $i
            if ($l3 -ge 1) { break }
            $i++
        }
        [void]$sb.Append($Single.GetString($Bytes[$start..($i - 1)]))
    }
    return $sb.ToString()
}

# Доля кириллических букв — критерий выбора кодировки. Псевдографика cp866
# кириллицей не считается, поэтому проигрывает естественно.
function Get-CyrillicRatio {
    param([string]$Text)
    if ($Text.Length -eq 0) { return 0.0 }
    $cyr = ([regex]::Matches($Text, '[\u0400-\u04FF]')).Count
    return $cyr / $Text.Length
}

$exit = 0
foreach ($f in $File) {
    if (-not (Test-Path $f)) { Write-Host "$f : НЕТ ФАЛА"; $exit = 1; continue }
    $bytes = [System.IO.File]::ReadAllBytes($f)
    Write-Host ("=== " + (Split-Path $f -Leaf) + "  " + $bytes.Length + " Б ===")

    $best = $null
    $bestRatio = -1.0
    foreach ($cp in $CANDIDATES) {
        $enc = [System.Text.Encoding]::GetEncoding($cp)
        $t = Convert-Mixed -Bytes $bytes -Single $enc
        $r = Get-CyrillicRatio -Text $t
        $broken = ([regex]::Matches($t, "\uFFFD")).Count
        Write-Host ("  проба cp" + $cp + ": кириллица " + [math]::Round($r, 4) + ", U+FFFD " + $broken + ", длина " + $t.Length)
        if ($broken -eq 0 -and $r -gt $bestRatio) { $best = $t; $bestRatio = $r; $bestCp = $cp }
    }

    if (-not $best) {
        Write-Host '  НЕ ВОССТАНОВЛЕНО: ни одна кодировка не дала 0 U+FFFD'
        $exit = 1
        continue
    }

    Write-Host ("  выбрано cp" + $bestCp + ", кириллица " + [math]::Round($bestRatio, 4))
    # Показываем, как читается восстановленный текст вокруг бывших поломок.
    $lines = $best -split "`r?`n"
    $shown = 0
    for ($i = 0; $i -lt $lines.Length -and $shown -lt 4; $i++) {
        if ($lines[$i] -match '[\u0400-\u04FF]') {
            Write-Host ("    " + ($i + 1) + ": " + $lines[$i].Trim().Substring(0, [Math]::Min(80, $lines[$i].Trim().Length)))
            $shown++
        }
    }

    if ($DryRun) {
        Write-Host '  (DryRun — файл не записывается)'
    } else {
        $noBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($f, $best, $noBom)
        Write-Host ("  записано, " + (Get-Item $f).Length + " Б")
    }
}
exit $exit