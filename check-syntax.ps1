param([Parameter(Mandatory = $true)][string]$File)
$errs = $null
$tokens = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($File, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
  Write-Host ("PARSE FAIL: {0} error(s) in {1}" -f $errs.Count, (Split-Path $File -Leaf))
  foreach ($e in ($errs | Select-Object -First 8)) {
    Write-Host ("  line {0}: {1}" -f $e.Extent.StartLineNumber, $e.Message)
  }
  exit 1
}
Write-Host ("PARSE OK: {0}" -f (Split-Path $File -Leaf))
