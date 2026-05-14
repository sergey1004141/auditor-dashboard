$ErrorActionPreference = "Stop"

$serviceName = "AuditorDashboard"
$displayName = "Auditor Dashboard"
$projectRoot = if ($env:AUDITOR_PROJECT_ROOT) { $env:AUDITOR_PROJECT_ROOT } else { "C:\projects\MCP_analitic" }
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
$serviceRunnerPath = Join-Path $projectRoot "scripts\run-dashboard-service.ps1"
$nodePath = if ($env:AUDITOR_NODE_PATH) { $env:AUDITOR_NODE_PATH } else { "C:\Program Files\nodejs\node.exe" }
$logDir = if ($env:AUDITOR_LOG_DIR) { $env:AUDITOR_LOG_DIR } else { Join-Path $projectRoot "logs" }
$binDir = if ($env:AUDITOR_BIN_DIR) { $env:AUDITOR_BIN_DIR } else { Join-Path $projectRoot "bin" }
$stableNssmPath = Join-Path $binDir "nssm.exe"
$stdoutLog = Join-Path $logDir "auditor-dashboard-service.out.log"
$stderrLog = Join-Path $logDir "auditor-dashboard-service.err.log"
$scheduledTaskName = "Auditor Dashboard"
$port = if ($env:AUDITOR_DASHBOARD_PORT) { [int]$env:AUDITOR_DASHBOARD_PORT } else { 3777 }

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $binDir -Force | Out-Null

if (-not (Test-Path $nodePath)) {
  throw "System Node.js was not found at $nodePath"
}

if (-not (Test-Path $serverPath)) {
  throw "Dashboard server was not found at $serverPath"
}

if (-not (Test-Path $serviceRunnerPath)) {
  throw "Dashboard service runner was not found at $serviceRunnerPath"
}

if (-not (Test-Path $stableNssmPath)) {
  $nssmSource = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter nssm.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\win64\\nssm.exe$" } |
    Select-Object -First 1

  if (-not $nssmSource) {
    throw "NSSM was not found under the current user's WinGet packages."
  }

  Copy-Item -LiteralPath $nssmSource.FullName -Destination $stableNssmPath -Force
}

$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
  if ($existingService.Status -ne "Stopped") {
    & $stableNssmPath stop $serviceName | Out-Null
    Start-Sleep -Seconds 1
  }
  & $stableNssmPath remove $serviceName confirm | Out-Null
  Start-Sleep -Seconds 1
}

$connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
  if ($connection.OwningProcess -gt 0) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
    if ($process.CommandLine -like "*$serverPath*") {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

& $stableNssmPath install $serviceName "powershell.exe" "-NoProfile" "-ExecutionPolicy" "Bypass" "-File" $serviceRunnerPath | Out-Null
& $stableNssmPath set $serviceName DisplayName $displayName | Out-Null
& $stableNssmPath set $serviceName Description "Auditor system dashboard HTTP server for the local 192.168.88.x subnet." | Out-Null
& $stableNssmPath set $serviceName AppDirectory $projectRoot | Out-Null
& $stableNssmPath set $serviceName AppStdout $stdoutLog | Out-Null
& $stableNssmPath set $serviceName AppStderr $stderrLog | Out-Null
& $stableNssmPath set $serviceName AppRotateFiles 1 | Out-Null
& $stableNssmPath set $serviceName AppRotateOnline 1 | Out-Null
& $stableNssmPath set $serviceName AppRotateBytes 1048576 | Out-Null
& $stableNssmPath set $serviceName Start SERVICE_AUTO_START | Out-Null
& $stableNssmPath set $serviceName AppThrottle 1500 | Out-Null
& $stableNssmPath set $serviceName AppExit Default Restart | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
& sc.exe failureflag $serviceName 1 | Out-Null

if (Get-ScheduledTask -TaskName $scheduledTaskName -ErrorAction SilentlyContinue) {
  Disable-ScheduledTask -TaskName $scheduledTaskName | Out-Null
}

Start-Service -Name $serviceName
Start-Sleep -Seconds 2

$service = Get-Service -Name $serviceName
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1 LocalAddress,LocalPort,State,OwningProcess

[pscustomobject]@{
  serviceName = $service.Name
  status = $service.Status.ToString()
  startType = $service.StartType.ToString()
  nodePath = $nodePath
  nssmPath = $stableNssmPath
  listener = $listener
  scheduledTaskDisabled = [bool](Get-ScheduledTask -TaskName $scheduledTaskName -ErrorAction SilentlyContinue)
  stdoutLog = $stdoutLog
  stderrLog = $stderrLog
} | ConvertTo-Json -Depth 5
