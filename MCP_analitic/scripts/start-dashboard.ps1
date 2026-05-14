param(
  [int]$Port = 3777,
  [string]$HostAddress = "0.0.0.0",
  [string]$AllowedSubnet = "192.168.88."
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$envPath = Join-Path $projectRoot ".env"

if (Test-Path -LiteralPath $envPath) {
  foreach ($line in Get-Content -LiteralPath $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    if ($trimmed -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"').Trim("'"), "Process")
    }
  }
}

$serverPath = if ($env:AUDITOR_SERVER_ENTRY) { $env:AUDITOR_SERVER_ENTRY } else { Join-Path $projectRoot "src\server.js" }
$logDir = if ($env:AUDITOR_LOG_DIR) { $env:AUDITOR_LOG_DIR } else { Join-Path $projectRoot "logs" }
$logPath = Join-Path $logDir "dashboard.log"
$Port = if ($env:AUDITOR_DASHBOARD_PORT) { [int]$env:AUDITOR_DASHBOARD_PORT } else { $Port }
$HostAddress = if ($env:AUDITOR_DASHBOARD_HOST) { $env:AUDITOR_DASHBOARD_HOST } else { $HostAddress }
$AllowedSubnet = if ($env:PROJECT_WATCH_ALLOWED_SUBNET) { $env:PROJECT_WATCH_ALLOWED_SUBNET } else { $AllowedSubnet }

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
  if ($connection.OwningProcess -gt 0) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process.CommandLine -like "*$serverPath*") {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

$systemNode = if ($env:AUDITOR_NODE_PATH) { $env:AUDITOR_NODE_PATH } else { "C:\Program Files\nodejs\node.exe" }
if (-not (Test-Path $systemNode)) {
  throw "System Node.js was not found at $systemNode."
}
$nodePath = $systemNode

$arguments = @(
  $serverPath,
  "--web",
  "--host",
  $HostAddress,
  "--port",
  "$Port",
  "--allow-subnet",
  $AllowedSubnet
)

"$(Get-Date -Format o) starting dashboard on ${HostAddress}:${Port}" | Out-File -FilePath $logPath -Append -Encoding utf8
Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden
