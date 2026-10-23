param([Parameter(Mandatory=$true)][string]$Id)

$user = "teivrim21@gmail.com"
$pass = "ugbptbvtwjlpbknu"
$root = "D:\SOOBSHESTVA\AUTOMATIC\RABOTA_RADICAL"

$emlPath = Join-Path $root "outbox\$Id.eml"
if (-not (Test-Path $emlPath)) { Write-Host "NO_FILE $Id"; exit 2 }

$raw = [System.IO.File]::ReadAllText($emlPath, [System.Text.Encoding]::UTF8)
$split = $raw -split "`r?`n`r?`n", 2
$head = $split[0]
$rest = $split[1]

$from = ([regex]::Match($head, '(?im)^From:.*?<([^>]+)>')).Groups[1].Value
$to   = ([regex]::Match($head, '(?im)^To:\s*(.+)')).Groups[1].Value.Trim()
$subj = ([regex]::Match($head, '(?im)^Subject:\s*(.+)$')).Groups[1].Value.Trim()
if ($subj -match '^=\?utf-8\?B\?([A-Za-z0-9+/=]+)\?=$') {
    $subj = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($matches[1]))
}

Write-Host ("ID=" + $Id + " from=" + $from + " to=" + $to)
Write-Host ("subject=" + $subj)

# имена вложений
$atts = [regex]::Matches($raw, 'Content-Disposition: attachment; filename="([^"]+)"') |
        ForEach-Object { $_.Groups[1].Value }
Write-Host ("attachments=" + ($atts -join ','))

# текст: первая text/plain секция в base64
$lines = $rest -split "`r?`n"
$b64 = @()
$inPlain = $false
$done = $false
foreach ($l in $lines) {
    if (-not $done -and $l -match 'Content-Type: text/plain') { $inPlain = $true; continue }
    if ($inPlain -and $l -match 'Content-Transfer-Encoding: base64') { continue }
    if ($inPlain -and $l -match '^--') { $done = $true; break }
    if ($inPlain -and $l.Trim() -ne '') { $b64 += $l.Trim() }
}
$body = ''
if ($b64.Count -gt 0) {
    $body = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($b64 -join '')))
}
Write-Host ("body chars=" + $body.Length)

$msg = New-Object System.Net.Mail.MailMessage
$msg.From = New-Object System.Net.Mail.MailAddress($from)
$msg.To.Add($to)
$msg.Subject = $subj
$msg.SubjectEncoding = [Text.Encoding]::UTF8
$msg.Body = $body
$msg.BodyEncoding = [Text.Encoding]::UTF8
$msg.IsBodyHtml = $false

foreach ($a in $atts) {
    $p = Join-Path $root "outbox\sample\$a"
    if (Test-Path $p) {
        $msg.Attachments.Add((New-Object System.Net.Mail.Attachment($p, 'text/html')))
    } else {
        Write-Host ("MISSING attachment: " + $a)
    }
}

$client = New-Object System.Net.Mail.SmtpClient('smtp.gmail.com', 587)
$client.EnableSsl = $true
$client.DeliveryMethod = [System.Net.Mail.SmtpDeliveryMethod]::Network
$client.Timeout = 40000
$client.Credentials = New-Object System.Net.NetworkCredential($user, $pass)

try {
    $client.Send($msg)
    Write-Host "RESULT=SENT_OK"
} catch {
    $ex = $_.Exception
    $chain = @()
    while ($null -ne $ex) { $chain += ($ex.GetType().FullName + ' >> ' + $ex.Message); $ex = $ex.InnerException }
    Write-Host ("RESULT=SEND_FAIL >> " + ($chain -join ' ||| '))
} finally {
    $msg.Dispose()
}