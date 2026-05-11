# Windows Server Profile

PowerShell profile for making this Windows 10 Pro machine behave more like a small server.

The scripts are staged and reversible:

- `00-audit.ps1` - collects current services, startup apps, scheduled tasks, network profile, and power config.
- `10-apply-server-baseline.ps1` - applies a conservative server baseline.
- `90-rollback.ps1` - restores service startup types from a saved backup.

Run PowerShell as Administrator for full effect.

## Recommended first run

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
cd C:\projects\windows-server-profile
.\00-audit.ps1
.\10-apply-server-baseline.ps1 -SetPrivateNetwork -DisableHibernation -DisableConsumerStartup
```

Most service, network profile, and HKLM policy changes require Administrator rights. You can launch the recommended elevated baseline with:

```powershell
C:\projects\windows-server-profile\run-admin-baseline.cmd
```

## Harder profile

Use only if the machine does not need printing, Bluetooth, Xbox/Game DVR, search indexing, or consumer background sync:

```powershell
.\10-apply-server-baseline.ps1 -SetPrivateNetwork -DisableHibernation -DisableConsumerStartup -DisablePrinting -DisableBluetooth
```

## Rollback

```powershell
.\90-rollback.ps1
```

## RDP

Enable Remote Desktop for the current user and allow inbound access only from `192.168.1.x`:

```powershell
C:\projects\windows-server-profile\run-admin-rdp.cmd
```

## Admin Runner

Install one elevated scheduled task:

```powershell
C:\projects\windows-server-profile\run-admin-task-install.cmd
```

After that, scripts in this folder can be launched through the task:

```powershell
.\run-admin-task.ps1 -ScriptName 21-repair-rdp-listener.ps1 -ScriptArgs "-AllowedSubnet","192.168.1.0/24","-Port","3389"
```

## What stays enabled

Core networking, Wi-Fi, audio, VPN, Windows Firewall, Defender, Event Log, RPC, WMI, Task Scheduler, DHCP/DNS client, user profile services, storage, Plug and Play, and Windows Update orchestration are not disabled by default.

Bluetooth is intentionally removed when `-DisableBluetooth` is used.
