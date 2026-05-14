$ErrorActionPreference = "Stop"

$serviceName = "AuditorDashboard"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne "Stopped") {
  Stop-Service -Name $serviceName -Force
  $service.WaitForStatus("Stopped", "00:00:20")
}

[pscustomobject]@{
  serviceName = $serviceName
  status = (Get-Service -Name $serviceName -ErrorAction SilentlyContinue).Status.ToString()
} | ConvertTo-Json -Depth 3
