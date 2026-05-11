param(
  [int] $Port = 3777,
  [string] $AllowedSubnet = "192.168.1.0/24",
  [string] $RuleName = "Project Watch Dashboard 3777"
)

$ErrorActionPreference = "Stop"

$Existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if (-not $Existing) {
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
} else {
  Set-NetFirewallRule -DisplayName $RuleName -Enabled True -Action Allow -Profile Private | Out-Null
  $Rule = Get-NetFirewallRule -DisplayName $RuleName
  Set-NetFirewallPortFilter -AssociatedNetFirewallRule $Rule -Protocol TCP -LocalPort $Port | Out-Null
  Set-NetFirewallAddressFilter -AssociatedNetFirewallRule $Rule -RemoteAddress $AllowedSubnet | Out-Null
  Write-Host "Updated firewall rule '$RuleName' for TCP $Port from $AllowedSubnet."
}
