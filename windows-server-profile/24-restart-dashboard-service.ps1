$ErrorActionPreference = "Stop"

$serviceName = "AuditorDashboard"
$service = Get-Service -Name $serviceName -ErrorAction Stop

if ($service.Status -ne "Stopped") {
  Stop-Service -Name $serviceName -Force -ErrorAction Stop
  $service.WaitForStatus("Stopped", "00:00:20")
}

Start-Service -Name $serviceName -ErrorAction Stop
(Get-Service -Name $serviceName).WaitForStatus("Running", "00:00:20")

Get-Service -Name $serviceName | Select-Object Name, Status, StartType
