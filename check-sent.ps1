param([switch]$Raw)
$user = "teivrim21@gmail.com"
$pass = "ugbptbvtwjlpbknu"

$tcp = [System.Net.Sockets.TcpClient]::new()
$ar = $tcp.BeginConnect("imap.gmail.com", 993, $null, $null)
if (-not $ar.AsyncWaitHandle.WaitOne(15000)) { Write-Host "TIMEOUT"; exit 1 }
$tcp.EndConnect($ar)
$stream = $tcp.GetStream(); $stream.ReadTimeout = 25000
$ssl = [System.Net.Security.SslStream]::new($stream, $false, ({$true} -as [System.Net.Security.RemoteCertificateValidationCallback]))
$ssl.AuthenticateAsClient("imap.gmail.com")
$rd = [System.IO.StreamReader]::new($ssl)
$wr = [System.IO.StreamWriter]::new($ssl); $wr.AutoFlush = $true

function Read-Until([string]$tag) {
    $lines = @()
    while ($true) {
        $l = $rd.ReadLine()
        if ($null -eq $l) { break }
        if ($l.StartsWith($tag + " ")) { return $lines }
        $lines += $l
    }
    return $lines
}

$null = Read-Until '*'
$wr.WriteLine("a1 LOGIN `"$user`" `"$pass`""); $null = Read-Until 'a1'
$wr.WriteLine('a2 SELECT "[Gmail]/&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"'); $null = Read-Until 'a2'
# Жёсткий диапазон 1:12 переставал видеть письма, как только их становилось больше:
# новые уходили в хвост и отправка выглядела неподтверждённой. Тянем все заголовки.
$wr.WriteLine('a3 UID SEARCH ALL')
$sr = Read-Until 'a3'
$uids = @()
foreach ($l in $sr) { if ($l -match '^\* SEARCH') { $uids = (@($l -replace '^\* SEARCH\s*', '') -join ' ') -split '\s+' | Where-Object { $_ } } }
Write-Host ("в папке отправленных: " + $uids.Count)
if ($uids.Count -eq 0) { $ssl.Dispose(); $tcp.Close(); return }
$list = if ($uids.Count -le 60) { $uids -join ',' } else { ($uids | Select-Object -Last 60) -join ',' }
# именно UID FETCH: номера из SEARCH ALL - это UID, а FETCH без префикса взял бы
# последовательные номера и вернул бы чужие письма
$wr.WriteLine("a4 UID FETCH $list (BODY.PEEK[HEADER.FIELDS (TO SUBJECT DATE)])")
$h = Read-Until 'a4'
$txt = $h -join "`n"

$tos  = [regex]::Matches($txt, '(?im)^To:\s*(.+)$')
$subs = [regex]::Matches($txt, '(?im)^Subject:\s*(.+)')
$dts  = [regex]::Matches($txt, '(?im)^Date:\s*(.+)')

Write-Host ("COUNT=" + $tos.Count)
for ($i = 0; $i -lt $tos.Count; $i++) {
    $to = $tos[$i].Groups[1].Value.Trim()
    $su = if ($i -lt $subs.Count) {
        $v = $subs[$i].Groups[1].Value.Trim()
        if ($v -match '^=\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=$') { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($matches[1])) } else { $v }
    } else { '?' }
    $dt = if ($i -lt $dts.Count) { $dts[$i].Groups[1].Value.Trim() } else { '?' }
    Write-Host ("ROW|" + $to + "|" + $su + "|" + $dt)
}

$ssl.Dispose(); $tcp.Close()