param(
  [Parameter(Mandatory = $true)]
  [string] $ScriptName,

  [string[]] $ScriptArgs = @(),

  [string] $TaskName = "Auditor Admin Runner"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$QueueDir = Join-Path $Root "runner"
$RequestFile = Join-Path $QueueDir "request.json"
$LastResultFile = Join-Path $QueueDir "last-result.json"
New-Item -ItemType Directory -Path $QueueDir -Force | Out-Null

if (Test-Path -LiteralPath $LastResultFile) {
  Remove-Item -LiteralPath $LastResultFile -Force
}

[pscustomobject]@{
  scriptName = $ScriptName
  scriptArgs = $ScriptArgs
  requestedAt = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 5 | Out-File -FilePath $RequestFile -Encoding UTF8

Start-ScheduledTask -TaskName $TaskName

Write-Host "Started task '$TaskName' for $ScriptName."
Write-Host "Request file: $RequestFile"
Write-Host "Result file: $LastResultFile"
