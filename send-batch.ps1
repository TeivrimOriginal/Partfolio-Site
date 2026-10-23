# send-batch.ps1 - отправка списка писем по одному, с паузой и журналом.
# send-one.ps1 умеет одно письмо; индекс eml-index.csv перезаписывается каждым
# запуском make-eml, поэтому полагаться на него нельзя. Здесь список id задаётся
# явно, а факт отправки пишется в sent-log.csv сразу же.
#
#   .\send-batch.ps1 -Ids i006,i007,i008 -DelaySec 90

param(
    [Parameter(Mandatory = $true)][string[]]$Ids,
    [int]$DelaySec = 90,
    [switch]$SkipLog
)

# При запуске через `powershell -File` список приходит одной строкой
# "i006,i007,i008" - запятая доходит до скрипта как обычный символ, а не как
# разделитель аргументов. Поэтому делим сами, оба варианта работают.
$Ids = @($Ids | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Ids.Count -eq 0) { throw 'не передано ни одного id' }

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$enc = New-Object System.Text.UTF8Encoding($false)
$logPath = Join-Path $root 'sent-log.csv'
$results = @()

foreach ($id in $Ids) {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'send-one.ps1') -Id $id 2>&1 | Out-String
    $line = ($out -split "`r?`n" | Where-Object { $_ -match 'RESULT=' } | Select-Object -First 1)
    $ok = ($line -match 'SENT_OK')

    # получатель и тема - из самого письма, а не из индекса
    $eml = Join-Path $root "outbox\$id.eml"
    $to = ''; $subj = ''
    if (Test-Path $eml) {
        $raw = [IO.File]::ReadAllText($eml, [Text.Encoding]::UTF8)
        $head = ($raw -split "`r?`n`r?`n", 2)[0]
        $to = ([regex]::Match($head, '(?im)^To:\s*(.+)')).Groups[1].Value.Trim()
        $s = ([regex]::Match($head, '(?im)^Subject:\s*(.+)')).Groups[1].Value.Trim()
        if ($s -match '^=\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=$') {
            $s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($matches[1]))
        }
        $subj = $s
    }

    $status = if ($ok) { 'sent' } else { 'failed' }
    $err = if ($ok) { '' } else { ($line -replace '^RESULT=\S+\s*', '') }

    if (-not $SkipLog) {
        $have = $false
        if (Test-Path $logPath) {
            foreach ($r in (Import-Csv $logPath)) {
                if ($r.id -eq $id -and $r.status -eq 'sent') { $have = $true; break }
            }
        }
        if (-not $have) {
            $row = '"{0}","{1}","{2}","{3}","{4}","{5}","{6}","{7}"' -f `
                $id, $to, '', ($subj -replace '"', '""'), `
                (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $status, ($err -replace '"', '""'), ''
            $line2 = $row
            if (Test-Path $logPath) {
                $old = [IO.File]::ReadAllText($logPath, $enc).TrimEnd()
                [IO.File]::WriteAllText($logPath, ($old + "`n" + $line2 + "`n"), $enc)
            } else {
                [IO.File]::WriteAllText($logPath, ($line2 + "`n"), $enc)
            }
        }
    }

    $results += [pscustomobject]@{ id = $id; to = $to; status = $status }
    Write-Host ("  {0,-6} {1,-30} {2}" -f $id, $to, $status) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })

    if ($id -ne $Ids[-1] -and $DelaySec -gt 0) { Start-Sleep -Seconds $DelaySec }
}

Write-Host ''
$okc = @($results | Where-Object status -eq 'sent').Count
Write-Host ("итого отправлено: {0} из {1}" -f $okc, $results.Count)
return $results
