$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupDir = Join-Path $Root "backup"
$LogDir = Join-Path $Root "logs"
$ServiceBackup = Join-Path $BackupDir "services-before.json"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "rollback-$Stamp.log"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Log {
  param([string] $Message)
  $Line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $Line | Tee-Object -FilePath $LogFile -Append
}

if (-not (Test-Path $ServiceBackup)) {
  throw "Service backup not found: $ServiceBackup"
}

$Services = Get-Content -Path $ServiceBackup -Raw | ConvertFrom-Json

foreach ($Saved in $Services) {
  $Service = Get-Service -Name $Saved.Name -ErrorAction SilentlyContinue
  if (-not $Service) {
    Log "Service no longer exists: $($Saved.Name)"
    continue
  }

  try {
    Set-Service -Name $Saved.Name -StartupType $Saved.StartType -ErrorAction Stop
    Log "Restored startup type: $($Saved.Name) -> $($Saved.StartType)"
  } catch {
    Log "Could not restore $($Saved.Name): $($_.Exception.Message)"
  }
}

$RunKeys = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
)

foreach ($Key in $RunKeys) {
  $Item = Get-ItemProperty -Path $Key -ErrorAction SilentlyContinue
  if (-not $Item) { continue }

  $Item.PSObject.Properties |
    Where-Object { $_.Name.StartsWith("Disabled_") } |
    ForEach-Object {
      $OriginalName = $_.Name.Substring("Disabled_".Length)
      try {
        New-ItemProperty -Path $Key -Name $OriginalName -Value $_.Value -PropertyType String -Force | Out-Null
        Remove-ItemProperty -Path $Key -Name $_.Name -ErrorAction Stop
        Log "Restored startup value: $Key\$OriginalName"
      } catch {
        Log "Could not restore startup value ${Key}\${OriginalName}: $($_.Exception.Message)"
      }
    }
}

Log "Rollback done. Reboot is recommended."
