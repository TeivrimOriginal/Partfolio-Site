param([int]$Count = 20)
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
function Decode-S ([string]$v) {
    $v = $v.Trim()
    if ($v -match '^=\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=') {
        try { return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($matches[1])) } catch { }
    }
    return $v
}

$null = Read-Until '*'
$wr.WriteLine("a1 LOGIN `"$user`" `"$pass`""); $null = Read-Until 'a1'

# INBOX: есть ли вообще непрочитанные
$wr.WriteLine('a2 STATUS INBOX (MESSAGES UNSEEN)')
Write-Host (($null = Read-Until 'a2')) 2>$null
$s2 = Read-Until 'a2'
Write-Host ("INBOX: " + ($s2 -join ' '))

# список папок, чтобы найти довходящие
$wr.WriteLine('a3 LIST "" "*"')
$folders = Read-Until 'a3'
Write-Host "--- ПАПКИ ---"
foreach ($f in $folders) {
    if ($f -match 'LIST') {
        $m = [regex]::Match($f, 'LIST \([^)]*\) "[^"]*" (.+)$')
        if ($m.Success) { Write-Host ("  " + $m.Groups[1].Value.Trim('"')) }
    }
}
$ssl.Dispose(); $tcp.Close()
