param(
  [string] $NewName = "HOME-STEND"
)

$ErrorActionPreference = "Stop"

$CurrentName = $env:COMPUTERNAME
if ($CurrentName -ieq $NewName) {
  Write-Host "Computer is already named $NewName."
  return
}

Rename-Computer -NewName $NewName -Force -ErrorAction Stop
Write-Host "Computer rename scheduled: $CurrentName -> $NewName. Reboot is required."
