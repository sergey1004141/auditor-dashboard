param(
  [string] $ScriptName,

  [string[]] $ScriptArgs = @()
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AllowedRoot = (Resolve-Path -LiteralPath $Root).Path
$LogDir = Join-Path $Root "logs"
$QueueDir = Join-Path $Root "runner"
New-Item -ItemType Directory -Path $LogDir,$QueueDir -Force | Out-Null

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "admin-runner-$Stamp.log"
$RequestFile = Join-Path $QueueDir "request.json"
$LastResultFile = Join-Path $QueueDir "last-result.json"

function Log {
  param([string] $Message)
  $Line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $Line | Tee-Object -FilePath $LogFile -Append
}

function Write-Result {
  param(
    [string] $Status,
    [string] $Message,
    [int] $ExitCode = 0
  )

  [pscustomobject]@{
    status = $Status
    message = $Message
    exitCode = $ExitCode
    scriptName = $ScriptName
    scriptArgs = $ScriptArgs
    logFile = $LogFile
    finishedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Depth 5 | Out-File -FilePath $LastResultFile -Encoding UTF8
}

try {
  if (-not $ScriptName) {
    if (-not (Test-Path -LiteralPath $RequestFile)) {
      throw "No ScriptName was provided and no request file exists."
    }

    $Request = Get-Content -LiteralPath $RequestFile -Raw | ConvertFrom-Json
    $ScriptName = $Request.scriptName
    $ScriptArgs = @($Request.scriptArgs)
  }

  if ($ScriptName -notmatch '^[A-Za-z0-9_.-]+\.ps1$') {
    throw "ScriptName must be a simple .ps1 file name."
  }

  $ScriptPath = Join-Path $AllowedRoot $ScriptName
  $ResolvedScript = (Resolve-Path -LiteralPath $ScriptPath -ErrorAction Stop).Path

  if (-not $ResolvedScript.StartsWith($AllowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Script path is outside the allowed root."
  }

  if ($ResolvedScript -eq $MyInvocation.MyCommand.Path) {
    throw "admin-runner.ps1 cannot launch itself."
  }

  Log "Running elevated script: $ResolvedScript"
  Log "Args: $($ScriptArgs -join ' ')"

  & $ResolvedScript @ScriptArgs 2>&1 | Tee-Object -FilePath $LogFile -Append
  $ExitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }

  if ($ExitCode -ne 0) {
    Write-Result -Status "failed" -Message "Script returned exit code $ExitCode." -ExitCode $ExitCode
    exit $ExitCode
  }

  Write-Result -Status "ok" -Message "Script completed successfully." -ExitCode 0
  Log "Done."
} catch {
  Log "ERROR: $($_.Exception.Message)"
  Write-Result -Status "failed" -Message $_.Exception.Message -ExitCode 1
  exit 1
}
