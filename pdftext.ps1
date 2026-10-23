# Extract text from a PDF by inflating FlateDecode streams (no external deps).
# Usage: powershell -ExecutionPolicy Bypass -File pdftext.ps1 <file.pdf> [out.txt]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Out = ''
)

$bytes = [System.IO.File]::ReadAllBytes($Path)
$latin = [System.Text.Encoding]::GetEncoding(28591)
$raw = $latin.GetString($bytes)

$sb = New-Object System.Text.StringBuilder

# Walk stream objects: "stream" ... "endstream"
$idx = 0
while ($true) {
  $s = $raw.IndexOf('stream', $idx)
  if ($s -lt 0) { break }
  # skip EOL after the "stream" keyword
  $p = $s + 6
  if ($p -lt $raw.Length -and $raw[$p] -eq "`r") { $p++ }
  if ($p -lt $raw.Length -and $raw[$p] -eq "`n") { $p++ }
  $e = $raw.IndexOf('endstream', $p)
  if ($e -lt 0) { break }
  $len = $e - $p
  if ($len -le 0) { $idx = $e + 9; continue }

  $chunk = New-Object byte[] $len
  [Array]::Copy($bytes, $p, $chunk, 0, $len)
  try {
    # raw deflate (skip 2-byte zlib header) then full zlib as fallback
    $ms = New-Object System.IO.MemoryStream(,$chunk)
    try {
      $ms.ReadByte() | Out-Null; $ms.ReadByte() | Out-Null
      $ds = New-Object System.IO.Compression.DeflateStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
      $sr = New-Object System.IO.StreamReader($ds, $latin)
      $txt = $sr.ReadToEnd()
      $sr.Close()
      if ($txt -match 'BT|Tj|TJ|Tf') { $null = $sb.Append($txt); $null = $sb.Append("`n") }
    } catch {
      $ms2 = New-Object System.IO.MemoryStream(,$chunk)
      $ds2 = New-Object System.IO.Compression.DeflateStream($ms2, [System.IO.Compression.CompressionMode]::Decompress)
      $sr2 = New-Object System.IO.StreamReader($ds2, $latin)
      $txt2 = $sr2.ReadToEnd(); $sr2.Close()
      if ($txt2 -match 'BT|Tj|TJ|Tf') { $null = $sb.Append($txt2); $null = $sb.Append("`n") }
    }
  } catch { }
  $idx = $e + 9
}

$content = $sb.ToString()

# Pull the literal strings that are actually drawn on the page.
$words = New-Object System.Collections.ArrayList
foreach ($m in [regex]::Matches($content, '\(((?:\\.|[^\\()])*)\)\s*Tj')) {
  $v = $m.Groups[1].Value
  $v = $v -replace '\\([()\\])', '$1'
  $null = $words.Add($v)
}
foreach ($m in [regex]::Matches($content, '\[((?:[^\[\]]|\\.)*)\]\s*TJ')) {
  $arr = $m.Groups[1].Value
  foreach ($p in [regex]::Matches($arr, '\(((?:\\.|[^\\()])*)\)')) {
    $v = $p.Groups[1].Value -replace '\\([()\\])', '$1'
    $null = $words.Add($v)
  }
}

$text = ($words -join ' ')
$text = $text -replace '\s+', ' '

if ($Out) {
  [System.IO.File]::WriteAllText($Out, $text, [System.Text.Encoding]::UTF8)
  Write-Host "chars: $($text.Length) -> $Out"
} else {
  Write-Host $text
}