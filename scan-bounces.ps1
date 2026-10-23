$user = "teivrim21@gmail.com"
$pass = "ugbptbvtwjlpbknu"

$tcp = [System.Net.Sockets.TcpClient]::new()
$ar = $tcp.BeginConnect("imap.gmail.com", 993, $null, $null)
if (-not $ar.AsyncWaitHandle.WaitOne(15000)) { Write-Host "TIMEOUT"; exit 1 }
$tcp.EndConnect($ar)
$s = $tcp.GetStream(); $s.ReadTimeout = 40000
$ssl = [System.Net.Security.SslStream]::new($s, $false, ({$true} -as [System.Net.Security.RemoteCertificateValidationCallback]))
$ssl.AuthenticateAsClient("imap.gmail.com")
$rd = [System.IO.StreamReader]::new($ssl)
$wr = [System.IO.StreamWriter]::new($ssl); $wr.AutoFlush = $true

function U([string]$t) {
    $l = @()
    while ($true) {
        $x = $rd.ReadLine()
        if ($null -eq $x) { break }
        if ($x.StartsWith($t + " ")) { return $l }
        $l += $x
    }
    return $l
}

$null = U "*"
$wr.WriteLine("a1 LOGIN `"$user`" `"$pass`""); $null = U "a1"
$wr.WriteLine("a2 SELECT INBOX"); $null = U "a2"

$wr.WriteLine("a3 SEARCH SINCE 01-Oct-2026")
$r = U "a3"
$ids = @()
foreach ($l in $r) { if ($l -match '^\* SEARCH') { $ids = (@($l -replace '^\* SEARCH\s*', '') -join ' ') -split '\s+' | Where-Object { $_ } } }
Write-Host ("всего с 01.10: " + $ids.Count)

if ($ids.Count -gt 0) {
    $sel = ($ids -join ',')
    $wr.WriteLine("a4 FETCH $sel (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
    $h = U "a4"
    $txt = $h -join "`n"
    $froms = [regex]::Matches($txt, '(?im)^From:\s*(.+)$')
    $subs  = [regex]::Matches($txt, '(?im)^Subject:\s*(.+)$')

    # индексы отказов
    $bounceIdx = @()
    for ($i = 0; $i -lt $subs.Count; $i++) {
        if ($subs[$i].Groups[1].Value -match 'Delivery Status Notification') { $bounceIdx += $i }
    }
    Write-Host ("отказов найдено: " + $bounceIdx.Count)

    # id порядок соответствует порядку fetch — берём совпадающие по позиции
    foreach ($i in $bounceIdx) {
        $id = if ($i -lt $ids.Count) { $ids[$i] } else { $ids[-1] }
        $wr.WriteLine("a5 FETCH $id BODY.PEEK[TEXT]")
        $b = U "a5"
        $t = [Net.WebUtility]::HtmlDecode(($b -join "`n"))
        Write-Host ("=== отказ id=" + $id + " ===")
        foreach ($pat in @('Final-Recipient:[^\r\n]*', 'Action:[^\r\n]*', 'Status:[^\r\n]*', 'Diagnostic-Code:[^\r\n]*', 'Original-Recipient:[^\r\n]*')) {
            foreach ($m in [regex]::Matches($t, "(?im)$pat")) { Write-Host ("   " + $m.Value.Trim()) }
        }
    }
}
$ssl.Dispose(); $tcp.Close()
