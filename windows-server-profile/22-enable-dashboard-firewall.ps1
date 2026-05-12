param(
  [int] $Port = 3777,
  [string] $AllowedSubnet = "192.168.1.0/24",
  [string] $RuleName = "Project Watch Dashboard 3777"
)

$ErrorActionPreference = "Stop"

$Existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($Existing) {
  Remove-NetFirewallRule -DisplayName $RuleName
  Write-Host "Removed existing firewall rule '$RuleName'."
}

New-NetFirewallRule `
  -DisplayName $RuleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $Port `
  -RemoteAddress $AllowedSubnet `
  -Profile Private `
  -Enabled True | Out-Null
Write-Host "Created firewall rule '$RuleName' for TCP $Port from $AllowedSubnet."
