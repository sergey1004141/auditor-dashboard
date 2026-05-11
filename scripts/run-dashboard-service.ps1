$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$nodePath = "C:\Program Files\nodejs\node.exe"
$serverPath = Join-Path $projectRoot "src\server.js"
$secretPath = Join-Path $projectRoot "secrets\rules-share.json"

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

& $nodePath $serverPath --web --host 0.0.0.0 --port 3777 --allow-subnet 192.168.1.
