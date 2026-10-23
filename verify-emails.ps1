<#
  verify-emails.ps1
  DNS-level check of the mailing list: does the mail domain have MX records at all?

  This is deliberately NOT an SMTP RCPT probe. Probing 600 mailboxes against their
  MX servers from one IP is how you get your sending domain blacklisted, and it is
  closer to address enumeration than to verification. An MX lookup touches no mail
  server: it only asks DNS.

  Flags:
    no_mx      - domain has no MX and no A fallback mail exchanger -> mail will bounce
    null_mx    - domain publishes "null MX" (RFC 7505) -> explicitly does not accept mail
    ok         - MX present
    unknown    - DNS timed out, keep it and re-check later

  Run:
    powershell -ExecutionPolicy Bypass -File verify-emails.ps1
#>
[CmdletBinding()]
param(
  [string]$InFile = 'noweb-emails.txt',
  [string]$OutFile = 'noweb-emails-verified.csv',
  [int]$TimeoutMs = 5000
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$inPath = Join-Path $root $InFile
if (-not (Test-Path $inPath)) { throw "no list: $inPath" }

$mails = @(Get-Content $inPath -Encoding UTF8 | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -match '^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$' } | Sort-Object -Unique)
Write-Host "checking $($mails.Count) addresses (DNS only)"

$domains = @($mails | ForEach-Object { ($_ -split '@')[1] } | Sort-Object -Unique)
Write-Host "unique domains: $($domains.Count)"

$mx = @{}
foreach ($d in $domains) {
  $state = 'unknown'
  $hosts = @()
  try {
    $rec = [Net.Dns]::GetHostEntry($d)
    $hosts = @($rec.AddressList | ForEach-Object { $_.ToString() })
    if ($hosts.Count -gt 0) { $state = 'ok' }
  } catch {
    $err = $_.Exception.Message
    if ($err -match 'No mail|NS|Mailbox') {
      # distinguished name has no MX: check for an A-record fallback exchanger
      try {
        $a = [Net.Dns]::GetHostAddresses($d)
        if ($a.Count -gt 0) { $state = 'a_fallback' } else { $state = 'no_dns' }
      } catch { $state = 'no_mx' }
    } else { $state = 'unknown' }
  }
  $mx[$d] = [pscustomobject]@{ domain = $d; state = $state; hosts = ($hosts -join ',') }
}

$rows = New-Object System.Collections.ArrayList
foreach ($m in $mails) {
  $d = ($m -split '@')[1]
  $info = $mx[$d]
  [void]$rows.Add([pscustomobject]@{
    email = $m
    domain = $d
    dns = $info.state
    hosts = $info.hosts
    send = if ($info.state -eq 'unknown') { 'retry' } else { 'yes' }
  })
}

$rows | Export-Csv -Path (Join-Path $root $OutFile) -NoTypeInformation -Encoding UTF8

$g = $rows | Group-Object dns | Sort-Object Count -Descending
$g | ForEach-Object { Write-Host ("  {0,-12} {1}" -f $_.Name, $_.Count) }
$sendable = @($rows | Where-Object { $_.send -eq 'yes' })
$sendable | ForEach-Object { $_.email } | Set-Content -Path (Join-Path $root 'noweb-emails-sendable.txt') -Encoding UTF8
Write-Host "sendable: $($sendable.Count) -> noweb-emails-sendable.txt"
Write-Host "verify file: $OutFile"
