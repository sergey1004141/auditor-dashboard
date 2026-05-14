$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$envPath = Join-Path $projectRoot ".env"

function Import-DotEnv {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim().Trim('"').Trim("'")
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

Import-DotEnv -Path $envPath

$nodePath = if ($env:AUDITOR_NODE_PATH) { $env:AUDITOR_NODE_PATH } else { "C:\Program Files\nodejs\node.exe" }
$serverPath = if ($env:AUDITOR_SERVER_ENTRY) { $env:AUDITOR_SERVER_ENTRY } else { Join-Path $projectRoot "src\server.js" }
$secretPath = if ($env:AUDITOR_RULES_SECRET_FILE) { $env:AUDITOR_RULES_SECRET_FILE } else { Join-Path $projectRoot "secrets\rules-share.json" }
$hostAddress = if ($env:AUDITOR_DASHBOARD_HOST) { $env:AUDITOR_DASHBOARD_HOST } else { "0.0.0.0" }
$port = if ($env:AUDITOR_DASHBOARD_PORT) { [int]$env:AUDITOR_DASHBOARD_PORT } else { 3777 }

function Get-AllowedSubnetPrefix {
  if ($env:PROJECT_WATCH_ALLOWED_SUBNET) {
    return $env:PROJECT_WATCH_ALLOWED_SUBNET
  }

  $address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like "192.168.*" -and $_.AddressState -eq "Preferred" } |
    Select-Object -First 1 -ExpandProperty IPAddress

  if ($address -match '^(\d+\.\d+\.\d+)\.\d+$') {
    return "$($Matches[1])."
  }

  return "192.168.88."
}

if (-not (Test-Path $nodePath)) {
  throw "System Node.js was not found at $nodePath."
}

if (-not (Test-Path $serverPath)) {
  throw "Dashboard server was not found at $serverPath."
}

if (Test-Path $secretPath) {
  $secret = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json

  if ($secret.shareRoot -and $secret.username -and $secret.password) {
    cmd.exe /c "net use `"$($secret.shareRoot)`" /delete /y >nul 2>nul"
    cmd.exe /c "net use `"$($secret.shareRoot)`" `"$($secret.password)`" /user:`"$($secret.username)`" /persistent:no >nul"
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to connect rules share $($secret.shareRoot) as $($secret.username)."
    }
  }

  if ($secret.shareRoot) {
    $env:AUDITOR_TASKS_ROOT = $secret.shareRoot
  }

  if ($secret.rulesPath) {
    $env:AUDITOR_RULES_PATH = $secret.rulesPath
  }

  if ($secret.rulesFile) {
    $env:AUDITOR_RULES_FILE = $secret.rulesFile
  }

  if ($secret.role) {
    $env:AUDITOR_RULES_ROLE = $secret.role
  }
}

$allowedSubnet = Get-AllowedSubnetPrefix
& $nodePath $serverPath --web --host $hostAddress --port $port --allow-subnet $allowedSubnet
