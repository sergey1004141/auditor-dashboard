param(
  [switch] $SetPrivateNetwork,
  [switch] $DisableHibernation,
  [switch] $DisableConsumerStartup,
  [switch] $DisablePrinting,
  [switch] $DisableBluetooth,
  [switch] $AllowLimited
)

$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupDir = Join-Path $Root "backup"
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Path $BackupDir,$LogDir -Force | Out-Null

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "apply-$Stamp.log"
$ServiceBackup = Join-Path $BackupDir "services-before.json"

function Log {
  param([string] $Message)
  $Line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $Line | Tee-Object -FilePath $LogFile -Append
}

function Test-Admin {
  $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = [Security.Principal.WindowsPrincipal]::new($Identity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Backup-Services {
  if (Test-Path $ServiceBackup) {
    Log "Service backup already exists: $ServiceBackup"
    return
  }

  Get-Service |
    Select-Object Name,DisplayName,Status,StartType |
    ConvertTo-Json -Depth 3 |
    Out-File -FilePath $ServiceBackup -Encoding UTF8
  Log "Service backup saved: $ServiceBackup"
}

function Disable-ServiceSafe {
  param([string] $Name)

  $Service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $Service) {
    Log "Service not found: $Name"
    return
  }

  try {
    if ($Service.Status -eq "Running" -and $Service.CanStop) {
      Stop-Service -Name $Name -Force -ErrorAction Stop
      Log "Stopped service: $Name"
    }
  } catch {
    Log "Could not stop service ${Name}: $($_.Exception.Message)"
  }

  try {
    Set-Service -Name $Name -StartupType Disabled -ErrorAction Stop
    Log "Disabled service: $Name"
  } catch {
    Log "Could not disable service ${Name}: $($_.Exception.Message)"
  }
}

function Set-ServiceManualSafe {
  param([string] $Name)

  $Service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $Service) {
    Log "Service not found: $Name"
    return
  }

  try {
    Set-Service -Name $Name -StartupType Manual -ErrorAction Stop
    Log "Set Manual service: $Name"
  } catch {
    Log "Could not set Manual service ${Name}: $($_.Exception.Message)"
  }
}

function Disable-RunValue {
  param(
    [string] $KeyPath,
    [string[]] $Names
  )

  foreach ($Name in $Names) {
    try {
      $Value = Get-ItemProperty -Path $KeyPath -Name $Name -ErrorAction SilentlyContinue
      if ($null -ne $Value) {
        $BackupName = "Disabled_$Name"
        New-ItemProperty -Path $KeyPath -Name $BackupName -Value $Value.$Name -PropertyType String -Force -ErrorAction Stop | Out-Null
        Remove-ItemProperty -Path $KeyPath -Name $Name -ErrorAction Stop
        Log "Disabled startup value: $KeyPath\$Name"
      }
    } catch {
      Log "Could not disable startup value ${KeyPath}\${Name}: $($_.Exception.Message)"
    }
  }
}

if (-not (Test-Admin)) {
  Log "ERROR: PowerShell is not elevated. Run as Administrator for the server baseline."
  if (-not $AllowLimited) {
    throw "PowerShell must be run as Administrator. Re-run with -AllowLimited only for user-level changes."
  }
}

Backup-Services

$DisableByDefault = @(
  "DiagTrack",
  "dmwappushservice",
  "MapsBroker",
  "lfsvc",
  "WSearch",
  "SysMain",
  "WerSvc",
  "PcaSvc",
  "RetailDemo",
  "Fax",
  "PhoneSvc",
  "WalletService",
  "wisvc",
  "WMPNetworkSvc",
  "XblAuthManager",
  "XblGameSave",
  "XboxGipSvc",
  "XboxNetApiSvc",
  "GameInputSvc",
  "BcastDVRUserService",
  "WpnService",
  "OneSyncSvc",
  "PimIndexMaintenanceSvc",
  "UnistoreSvc",
  "UserDataSvc",
  "NvStreamSvc",
  "NvStreamNetworkSvc",
  "GfExperienceService",
  "NvNetworkService",
  "Stereo Service",
  "YandexBrowserService",
  "edgeupdate",
  "edgeupdatem",
  "DoSvc",
  "DusmSvc"
)

foreach ($ServiceName in $DisableByDefault) {
  Disable-ServiceSafe $ServiceName
}

# Per-user service instances have suffixes, e.g. OneSyncSvc_55600.
$PerUserPrefixes = @(
  "AarSvc_",
  "BcastDVRUserService_",
  "BluetoothUserService_",
  "CaptureService_",
  "cbdhsvc_",
  "CDPUserSvc_",
  "ConsentUxUserSvc_",
  "CredentialEnrollmentManagerUserSvc_",
  "DeviceAssociationBrokerSvc_",
  "DevicePickerUserSvc_",
  "DevicesFlowUserSvc_",
  "MessagingService_",
  "OneSyncSvc_",
  "PimIndexMaintenanceSvc_",
  "PrintWorkflowUserSvc_",
  "UdkUserSvc_",
  "UnistoreSvc_",
  "UserDataSvc_",
  "WpnUserService_"
)

Get-Service | Where-Object {
  $Name = $_.Name
  $PerUserPrefixes | Where-Object { $Name.StartsWith($_) }
} | ForEach-Object {
  Disable-ServiceSafe $_.Name
}

$ManualServices = @(
  "BITS",
  "wuauserv",
  "UsoSvc",
  "WaaSMedicSvc",
  "TrustedInstaller",
  "msiserver",
  "VSS",
  "SDRSVC",
  "defragsvc",
  "WerSvc"
)

foreach ($ServiceName in $ManualServices) {
  Set-ServiceManualSafe $ServiceName
}

if ($DisablePrinting) {
  Disable-ServiceSafe "Spooler"
  Disable-ServiceSafe "PrintNotify"
}

if ($DisableBluetooth) {
  Disable-ServiceSafe "bthserv"
  Disable-ServiceSafe "BTAGService"
  Disable-ServiceSafe "BluetoothUserService"
}

if ($DisableConsumerStartup) {
  Disable-RunValue "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" @(
    "NvBackend",
    "ShadowPlay"
  )
  Disable-RunValue "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" @(
    "OneDrive",
    "MicrosoftEdgeAutoLaunch_8714F0D917266FE3AFB7F8BB98EEBC18"
  )
}

if ($SetPrivateNetwork) {
  try {
    Get-NetConnectionProfile |
      Where-Object { $_.NetworkCategory -ne "Private" } |
      Set-NetConnectionProfile -NetworkCategory Private -ErrorAction Stop
    Log "Network profile set to Private."
  } catch {
    Log "Could not set network profile to Private: $($_.Exception.Message)"
  }
}

try {
  powercfg /setactive SCHEME_MIN | Out-Null
  Log "Power plan set to High performance."
} catch {
  Log "Could not set High performance power plan: $($_.Exception.Message)"
}

try {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change monitor-timeout-ac 0 | Out-Null
  Log "AC sleep, hibernate, and monitor timeout disabled."
} catch {
  Log "Could not change AC power timeouts: $($_.Exception.Message)"
}

if ($DisableHibernation) {
  try {
    powercfg /hibernate off | Out-Null
    Log "Hibernation disabled."
  } catch {
    Log "Could not disable hibernation: $($_.Exception.Message)"
  }
}

try {
  New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Name "AllowGameDVR" -Value 0 -PropertyType DWord -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path "HKCU:\System\GameConfigStore" -Name "GameDVR_Enabled" -Value 0 -PropertyType DWord -Force -ErrorAction Stop | Out-Null
  Log "Game DVR disabled by policy."
} catch {
  Log "Could not disable Game DVR policy: $($_.Exception.Message)"
}

try {
  New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" -Name "AllowTelemetry" -Value 0 -PropertyType DWord -Force -ErrorAction Stop | Out-Null
  Log "Telemetry policy set to Security/lowest supported level."
} catch {
  Log "Could not set telemetry policy: $($_.Exception.Message)"
}

Log "Done. Reboot is recommended."
