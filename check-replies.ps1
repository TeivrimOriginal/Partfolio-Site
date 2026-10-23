param([string]$Since = "01-Oct-2026")
$user = "teivrim21@gmail.com"
$pass = "ugbptbvtwjlpbknu"

$tcp = [System.Net.Sockets.TcpClient]::new()
$ar = $tcp.BeginConnect("imap.gmail.com", 993, $null, $null)
if (-not $ar.AsyncWaitHandle.WaitOne(15000)) { Write-Host "TIMEOUT"; exit 1 }
$tcp.EndConnect($ar)
$stream = $tcp.GetStream(); $stream.ReadTimeout = 40000
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
function Dec([string]$v) {
    $v = $v.Trim()
    if ($v -match '^=\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=(\s+=\?utf-8\?B\?[A-Za-z0-9+/=]+\?=)*') {
        $all = [regex]::Matches($v, '\?B\?([A-Za-z0-9+/=]+)\?') 
        $out = ''
        foreach ($m in $all) { $out += [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($m.Groups[1].Value)) }
        if ($out) { return $out }
    }
    return $v
}

$null = Read-Until '*'
$wr.WriteLine("a1 LOGIN `"$user`" `"$pass`""); $null = Read-Until 'a1'
$wr.WriteLine('a2 SELECT INBOX')
$s = Read-Until 'a2'
Write-Host ("SELECT: " + ($s | Where-Object { $_ -match 'EXISTS|RECENT' } | Select-Object -First 1))

$wr.WriteLine("a3 SEARCH SINCE $Since")
$sr = Read-Until 'a3'
$ids = @()
foreach ($l in $sr) { if ($l -match '^\* SEARCH') { $ids = ($l -replace '^\* SEARCH\s*', '') -split '\s+' | Where-Object { $_ } } }
Write-Host ("найдено с " + $Since + ": " + $ids.Count)

if ($ids.Count -gt 0) {
    $sel = $ids[-1] + ":" + $ids[0]
    if ($ids.Count -gt 30) { $sel = (($ids | Select-Object -Last 30) -join ',') }
    $wr.WriteLine("a4 FETCH $sel (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])")
    $h = Read-Until 'a4'
    $txt = ($h -join "`n")
    $parts = [regex]::Matches($txt, '(?s)(?:\* \d+ FETCH\s*)?\(?(?:\d+ \()?(?:BODY\[HEADER\.FIELDS[^\]]*\]\s*)?')
    $froms = [regex]::Matches($txt, '(?im)^From:\s*(.+)$')
    $subs  = [regex]::Matches($txt, '(?im)^Subject:\s*(.+)$')
    $dts   = [regex]::Matches($txt, '(?im)^Date:\s*(.+)$')
    Write-Host "=== СВЕЖИЕ ==="
    $n = [Math]::Min($froms.Count, [Math]::Max($subs.Count, $dts.Count))
    for ($i = 0; $i -lt $froms.Count; $i++) {
        $f = Dec $froms[$i].Groups[1].Value
        $su = if ($i -lt $subs.Count) { Dec $subs[$i].Groups[1].Value } else { '' }
        $dt = if ($i -lt $dts.Count) { $dts[$i].Groups[1].Value.Trim() } else { '' }
        Write-Host ("ROW|" + $f + "|" + $su + "|" + $dt)
    }
}
$ssl.Dispose(); $tcp.Close()
