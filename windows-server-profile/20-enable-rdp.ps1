param(
  [string] $UserName = "DESKTOP-GT8NM2N\user",
  [string] $AllowedSubnet = "192.168.1.0/24",
  [int] $Port = 3389
)

$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "rdp-$Stamp.log"

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

if (-not (Test-Admin)) {
  throw "Run this script as Administrator."
}

Log "Enabling RDP for user $UserName, allowed subnet $AllowedSubnet, port $Port."

try {
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -Value 0 -ErrorAction Stop
  Log "RDP connections enabled."
} catch {
  Log "Could not enable RDP connections: $($_.Exception.Message)"
}

try {
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" -Name "UserAuthentication" -Value 1 -ErrorAction Stop
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" -Name "PortNumber" -Value $Port -ErrorAction Stop
  Log "NLA enabled and RDP port set to $Port."
} catch {
  Log "Could not set RDP TCP options: $($_.Exception.Message)"
}

try {
  Set-Service -Name TermService -StartupType Automatic -ErrorAction Stop
  Start-Service -Name TermService -ErrorAction Stop
  Set-Service -Name UmRdpService -StartupType Manual -ErrorAction Stop
  Set-Service -Name SessionEnv -StartupType Manual -ErrorAction Stop
  Log "RDP services configured."
} catch {
  Log "Could not configure RDP services: $($_.Exception.Message)"
}

try {
  Add-LocalGroupMember -SID "S-1-5-32-555" -Member $UserName -ErrorAction Stop
  Log "Added $UserName to Remote Desktop Users."
} catch {
  if ($_.Exception.Message -match "already") {
    Log "$UserName is already in Remote Desktop Users."
  } else {
    Log "Could not add $UserName to Remote Desktop Users: $($_.Exception.Message)"
  }
}

try {
  Enable-NetFirewallRule -Name "RemoteDesktop-UserMode-In-TCP" -ErrorAction Stop
  Enable-NetFirewallRule -Name "RemoteDesktop-UserMode-In-UDP" -ErrorAction SilentlyContinue
  Set-NetFirewallRule -Name "RemoteDesktop-UserMode-In-TCP" -Profile Private -RemoteAddress $AllowedSubnet -Action Allow -Enabled True -ErrorAction Stop
  Set-NetFirewallRule -Name "RemoteDesktop-UserMode-In-UDP" -Profile Private -RemoteAddress $AllowedSubnet -Action Allow -Enabled True -ErrorAction SilentlyContinue
  Log "Built-in RDP firewall rules enabled for $AllowedSubnet on Private profile."
} catch {
  Log "Could not update built-in RDP firewall rules: $($_.Exception.Message)"
}

try {
  $Existing = Get-NetFirewallRule -DisplayName "RDP 3389 192.168.1.x" -ErrorAction SilentlyContinue
  if (-not $Existing) {
    New-NetFirewallRule -DisplayName "RDP 3389 192.168.1.x" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $AllowedSubnet -Profile Private -ErrorAction Stop | Out-Null
    Log "Fallback firewall rule created for TCP $Port from $AllowedSubnet."
  } else {
    Set-NetFirewallRule -DisplayName "RDP 3389 192.168.1.x" -Enabled True -Profile Private -Action Allow -ErrorAction Stop
    Set-NetFirewallPortFilter -AssociatedNetFirewallRule $Existing -LocalPort $Port -Protocol TCP -ErrorAction SilentlyContinue
    Set-NetFirewallAddressFilter -AssociatedNetFirewallRule $Existing -RemoteAddress $AllowedSubnet -ErrorAction SilentlyContinue
    Log "Fallback firewall rule updated."
  }
} catch {
  Log "Could not create fallback firewall rule: $($_.Exception.Message)"
}

try {
  Get-NetConnectionProfile |
    Where-Object { $_.NetworkCategory -ne "Private" } |
    Set-NetConnectionProfile -NetworkCategory Private -ErrorAction Stop
  Log "Network profile set to Private."
} catch {
  Log "Could not set network profile to Private: $($_.Exception.Message)"
}

Log "Done. If the account has no password, set one before using RDP."
