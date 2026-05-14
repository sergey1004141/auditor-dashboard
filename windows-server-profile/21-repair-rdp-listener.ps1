param(
  [string] $AllowedSubnet = "192.168.88.0/24",
  [int] $Port = 3389
)

$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "rdp-repair-$Stamp.log"

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

Log "Repairing RDP listener."

try {
  $CryptoPaths = @(
    "C:\ProgramData\Microsoft\Crypto\RSA\MachineKeys",
    "C:\ProgramData\Microsoft\Crypto\Keys"
  )
  foreach ($CryptoPath in $CryptoPaths) {
    & icacls.exe $CryptoPath /grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-20:(OI)(CI)RX' '*S-1-5-32-544:(OI)(CI)F' /T /C | Out-Null
  }
  Log "Crypto key ACL refreshed for SYSTEM, Administrators, and NETWORK SERVICE."
} catch {
  Log "Could not refresh crypto key ACL: $($_.Exception.Message)"
}

try {
  $Certificate = New-SelfSignedCertificate `
    -DnsName $env:COMPUTERNAME `
    -CertStoreLocation "Cert:\LocalMachine\My" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -Provider "Microsoft RSA SChannel Cryptographic Provider" `
    -KeySpec KeyExchange `
    -KeyExportPolicy NonExportable `
    -NotAfter (Get-Date).AddYears(5) `
    -FriendlyName "Project Watch RDP"

  $Thumbprint = $Certificate.Thumbprint
  Log "Created RDP certificate: $Thumbprint"

  $Setting = Get-CimInstance -Namespace root\cimv2\terminalservices -ClassName Win32_TSGeneralSetting -Filter "TerminalName='RDP-tcp'" -ErrorAction Stop
  Set-CimInstance -InputObject $Setting -Property @{ SSLCertificateSHA1Hash = $Thumbprint } -ErrorAction Stop
  Log "Bound certificate to RDP-Tcp."
} catch {
  Log "Could not create or bind RDP certificate: $($_.Exception.Message)"
}

try {
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -Value 0 -ErrorAction Stop
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" -Name "PortNumber" -Value $Port -ErrorAction Stop
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" -Name "UserAuthentication" -Value 1 -ErrorAction Stop
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" -Name "SecurityLayer" -Value 1 -ErrorAction Stop
  Log "RDP registry options refreshed. SecurityLayer set to Negotiate."
} catch {
  Log "Could not refresh RDP registry options: $($_.Exception.Message)"
}

try {
  Stop-Service -Name TermService -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
  Start-Service -Name TermService -ErrorAction Stop
  Start-Sleep -Seconds 2
  Log "TermService stopped and started."
} catch {
  Log "Could not stop/start TermService: $($_.Exception.Message)"
  try {
    Start-Service -Name TermService -ErrorAction Stop
    Log "TermService start requested."
  } catch {
    Log "Could not start TermService: $($_.Exception.Message)"
  }
}

try {
  Enable-NetFirewallRule -Name "RemoteDesktop-UserMode-In-TCP" -ErrorAction Stop
  Set-NetFirewallRule -Name "RemoteDesktop-UserMode-In-TCP" -Profile Private -RemoteAddress $AllowedSubnet -Action Allow -Enabled True -ErrorAction Stop
  Log "RDP firewall TCP rule enabled for $AllowedSubnet."
} catch {
  Log "Could not refresh RDP firewall rule: $($_.Exception.Message)"
}

try {
  $Listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($Listening) {
    Log "RDP is listening on TCP $Port."
  } else {
    Log "RDP is not listening on TCP $Port yet. A reboot may be required."
  }
} catch {
  Log "Could not verify TCP listener: $($_.Exception.Message)"
}

Log "Repair done."
