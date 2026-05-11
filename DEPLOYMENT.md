# Auditor Dashboard Deployment

This guide deploys the Auditor Dashboard as an independent Windows service.

## Requirements

- Windows 10/11 or Windows Server.
- Administrator rights.
- Local network in the `192.168.1.x` subnet.
- PowerShell 5+.
- Node.js LTS.
- NSSM.

## 1. Copy The Project

Place the project in:

```powershell
C:\projects
```

Expected entrypoint:

```powershell
C:\projects\src\server.js
```

## 2. Install Node.js LTS

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --id OpenJS.NodeJS.LTS --exact
```

Verify:

```powershell
& "C:\Program Files\nodejs\node.exe" --version
```

## 3. Install NSSM

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --id NSSM.NSSM --exact
```

The service installer copies `nssm.exe` into:

```powershell
C:\projects\bin\nssm.exe
```

This keeps the Windows service independent from the user's WinGet package cache.

## 4. Open The Firewall For The Local Subnet

Run PowerShell as Administrator:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\22-enable-dashboard-firewall.ps1
```

Default rule:

- Port: `3777`
- Protocol: TCP
- Remote subnet: `192.168.1.0/24`
- Profile: Private

## 5. Install The Windows Service

Run PowerShell as Administrator:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\23-install-dashboard-service.ps1
```

The script creates:

- Service name: `AuditorDashboard`
- Display name: `Auditor Dashboard`
- Startup type: Automatic
- Listen address: `0.0.0.0`
- Port: `3777`
- Allowed HTTP clients: `127.0.0.1`, `::1`, and `192.168.1.x`

It also disables the older scheduled task named `Auditor Dashboard` when present.

## 6. Verify The Service

```powershell
Get-Service AuditorDashboard
Get-NetTCPConnection -LocalPort 3777 -State Listen
Invoke-RestMethod http://127.0.0.1:3777/api/metrics/cpu
```

Expected:

- Service status: `Running`
- Listener: `0.0.0.0:3777`
- API returns JSON.

## 7. Open The Dashboard

On the server:

```text
http://127.0.0.1:3777/
```

From another machine in the same subnet:

```text
http://SERVER_IP:3777/
```

Example:

```text
http://192.168.1.108:3777/
```

## 8. Service Management

Restart:

```powershell
Restart-Service AuditorDashboard
```

Stop:

```powershell
Stop-Service AuditorDashboard
```

Start:

```powershell
Start-Service AuditorDashboard
```

Remove:

```powershell
Stop-Service AuditorDashboard
C:\projects\bin\nssm.exe remove AuditorDashboard confirm
```

## 9. Logs

Service logs:

```powershell
C:\projects\logs\auditor-dashboard-service.out.log
C:\projects\logs\auditor-dashboard-service.err.log
```

Admin runner logs:

```powershell
C:\projects\windows-server-profile\logs\
```

## 10. Runtime Behavior

- CPU: live Node-based measurement.
- RAM: live Node-based measurement, no PowerShell.
- GPU: direct Windows performance counter. On some machines this can take 1-3 seconds per sample.
- Disks: Windows CIM logical disk data.
- No npm dependencies are required.
