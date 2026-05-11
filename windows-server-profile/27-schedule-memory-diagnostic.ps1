$ErrorActionPreference = "Stop"

$BcdEdit = Join-Path $env:SystemRoot "System32\bcdedit.exe"

& $BcdEdit /enum "{memdiag}" | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Windows Memory Diagnostic boot entry was not found."
}

& $BcdEdit /bootsequence "{memdiag}"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to schedule Windows Memory Diagnostic for the next boot."
}

Write-Host "Windows Memory Diagnostic is scheduled for the next boot."
Write-Host "Restart the computer to start the memory test."
