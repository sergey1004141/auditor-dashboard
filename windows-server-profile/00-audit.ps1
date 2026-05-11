$ErrorActionPreference = "Continue"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutDir = Join-Path $Root "audit-$Stamp"
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

function Save-Text {
  param(
    [Parameter(Mandatory = $true)] [string] $Name,
    [Parameter(Mandatory = $true)] [scriptblock] $Command
  )

  $Path = Join-Path $OutDir $Name
  try {
    & $Command | Out-File -FilePath $Path -Encoding UTF8 -Width 240
  } catch {
    "ERROR: $($_.Exception.Message)" | Out-File -FilePath $Path -Encoding UTF8
  }
}

Save-Text "computer-info.txt" { Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsArchitecture,CsName,CsDomain,CsWorkgroup,CsPartOfDomain,CsTotalPhysicalMemory | Format-List }
Save-Text "services.txt" { Get-Service | Sort-Object Name | Select-Object Name,DisplayName,Status,StartType | Format-Table -AutoSize }
Save-Text "startup.txt" { Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User | Format-List }
Save-Text "net-profile.txt" { Get-NetConnectionProfile | Select-Object Name,InterfaceAlias,NetworkCategory,IPv4Connectivity,IPv6Connectivity | Format-Table -AutoSize }
Save-Text "ip-addresses.txt" { Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress,InterfaceAlias,PrefixLength,AddressState | Format-Table -AutoSize }
Save-Text "listening-ports.txt" { Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort | Format-Table -AutoSize }
Save-Text "scheduled-tasks.txt" { Get-ScheduledTask | Select-Object TaskPath,TaskName,State | Sort-Object TaskPath,TaskName | Format-Table -AutoSize }
Save-Text "powercfg-a.txt" { powercfg /a }
Save-Text "powercfg-active.txt" { powercfg /getactivescheme }

Write-Host "Audit saved to $OutDir"
