<#
  test-filter-safety.ps1
  The filter once wiped a 6-row base to 0 because a non-raw file (one without a
  "status" column) was passed in. This test proves the two guards:
    1) a non-raw input yields an ERROR and exit code 3, base untouched
    2) raw input still produces leads
#>
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$fl = Join-Path $root 'filter-noweb.ps1'
$pass = 0; $fail = 0

function Check { param([string]$N, [bool]$Ok, [string]$D = '')
  if ($Ok) { $script:pass++; Write-Host "  PASS  $N" }
  else { $script:fail++; Write-Host "  FAIL  $N  $D" }
}

# снимок текущей базы
$leadsPath = Join-Path $root 'noweb-leads.csv'
$before = @(Import-Csv $leadsPath).Count
$beforeBytes = (Get-Item $leadsPath).Length
Write-Host "база до теста: $before строк, $beforeBytes байт"

$verified = Join-Path $root 'noweb-leads-verified.csv'
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $fl -RawCsv 'noweb-leads-verified.csv' 2>&1
$code = $LASTEXITCODE
$after = @(Import-Csv $leadsPath).Count

Check 'не-сырой вход отклоняется кодом 3' ($code -eq 3) ("code=$code")
Check 'сообщение объясняет причину' (($out | Out-String) -match 'уже отфильтрован') ''
Check 'база не затронута' ($after -eq $before -and (Get-Item $leadsPath).Length -eq $beforeBytes) ("$before -> $after")

Write-Host ''
Write-Host ("ИТОГО: pass={0} fail={1}" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }
