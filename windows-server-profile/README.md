# Windows Server Profile

Набор PowerShell-скриптов для настройки Windows 10 Pro ближе к небольшому серверу.

Скрипты разложены так, чтобы изменения можно было применить поэтапно и откатить:

- `00-audit.ps1` - собирает текущее состояние служб, автозагрузки, задач планировщика, сетевого профиля и питания.
- `10-apply-server-baseline.ps1` - применяет осторожный серверный профиль.
- `90-rollback.ps1` - восстанавливает типы запуска служб из сохраненной резервной копии.

Для полного эффекта запускайте PowerShell от имени администратора.

## Рекомендуемый первый запуск

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
cd C:\projects\windows-server-profile
.\00-audit.ps1
.\10-apply-server-baseline.ps1 -SetPrivateNetwork -DisableHibernation -DisableConsumerStartup
```

Большинство изменений служб, сетевого профиля и HKLM-политик требуют прав администратора. Рекомендуемый baseline можно запустить с повышением прав так:

```powershell
C:\projects\windows-server-profile\run-admin-baseline.cmd
```

## Более жесткий профиль

Используйте только если машине не нужны печать, Bluetooth, Xbox/Game DVR, индексация поиска и потребительская фоновая синхронизация:

```powershell
.\10-apply-server-baseline.ps1 -SetPrivateNetwork -DisableHibernation -DisableConsumerStartup -DisablePrinting -DisableBluetooth
```

## Откат

```powershell
.\90-rollback.ps1
```

## RDP

Включить Remote Desktop для текущего пользователя и разрешить входящие подключения только из `192.168.1.x`:

```powershell
C:\projects\windows-server-profile\run-admin-rdp.cmd
```

## Admin Runner

Установить одну задачу планировщика с повышенными правами:

```powershell
C:\projects\windows-server-profile\run-admin-task-install.cmd
```

После этого скрипты из этой папки можно запускать через задачу:

```powershell
.\run-admin-task.ps1 -ScriptName 21-repair-rdp-listener.ps1 -ScriptArgs "-AllowedSubnet","192.168.1.0/24","-Port","3389"
```

## Что остается включенным

По умолчанию не отключаются: базовая сеть, Wi-Fi, audio, VPN, Windows Firewall, Defender, Event Log, RPC, WMI, Task Scheduler, DHCP/DNS client, службы профиля пользователя, хранилище, Plug and Play и оркестрация Windows Update.

Bluetooth намеренно отключается при использовании `-DisableBluetooth`.
