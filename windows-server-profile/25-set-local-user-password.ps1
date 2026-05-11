param(
  [string] $UserName = "user",
  [string] $PasswordFile = "C:\projects\secrets\rdp-password.txt"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PasswordFile)) {
  throw "Password file was not found."
}

$Password = (Get-Content -LiteralPath $PasswordFile -Raw).Trim()
if (-not $Password) {
  throw "Password file is empty."
}

try {
  & net.exe user $UserName $Password
  if ($LASTEXITCODE -ne 0) {
    throw "net user failed with exit code $LASTEXITCODE."
  }
} finally {
  Remove-Item -LiteralPath $PasswordFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Password was changed for local user $UserName."
