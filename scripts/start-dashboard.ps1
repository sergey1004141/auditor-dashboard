param(
  [int]$Port = 3777,
  [string]$HostAddress = "0.0.0.0",
  [string]$AllowedSubnet = "192.168.1."
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$serverPath = Join-Path $projectRoot "src\server.js"
$logDir = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDir "dashboard.log"

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

$systemNode = "C:\Program Files\nodejs\node.exe"
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
