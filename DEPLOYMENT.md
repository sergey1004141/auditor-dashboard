# Развертка Auditor Dashboard

Эта инструкция разворачивает Auditor Dashboard как независимую службу Windows.

## Требования

- Windows 10/11 или Windows Server.
- Права администратора.
- Локальная сеть в подсети `192.168.1.x`.
- PowerShell 5 или новее.
- Node.js LTS.
- NSSM.

## 1. Скопировать проект

Разместите проект в:

```powershell
C:\projects
```

Ожидаемая точка входа:

```powershell
C:\projects\src\server.js
```

## 2. Установить Node.js LTS

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --id OpenJS.NodeJS.LTS --exact
```

Проверка:

```powershell
& "C:\Program Files\nodejs\node.exe" --version
```

## 3. Установить NSSM

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --id NSSM.NSSM --exact
```

Скрипт установки службы копирует `nssm.exe` сюда:

```powershell
C:\projects\bin\nssm.exe
```

Так служба Windows не зависит от пользовательского кеша пакетов WinGet.

## 4. Открыть firewall для локальной подсети

Запустите PowerShell от имени администратора:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\22-enable-dashboard-firewall.ps1
```

Правило по умолчанию:

- порт: `3777`
- протокол: TCP
- удаленная подсеть: `192.168.1.0/24`
- профиль: Private

## 5. Установить службу Windows

Запустите PowerShell от имени администратора:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\23-install-dashboard-service.ps1
```

Скрипт создает:

- имя службы: `AuditorDashboard`
- отображаемое имя: `Auditor Dashboard`
- тип запуска: Automatic
- адрес прослушивания: `0.0.0.0`
- порт: `3777`
- разрешенные HTTP-клиенты: `127.0.0.1`, `::1` и `192.168.1.x`

Если существует старая задача планировщика `Auditor Dashboard`, скрипт отключает ее.

## 6. Проверить службу

```powershell
Get-Service AuditorDashboard
Get-NetTCPConnection -LocalPort 3777 -State Listen
Invoke-RestMethod http://127.0.0.1:3777/api/metrics/cpu
```

Ожидаемый результат:

- служба в состоянии `Running`
- порт слушает `0.0.0.0:3777`
- API возвращает JSON.

## 7. Открыть дашборд

На самом сервере:

```text
http://127.0.0.1:3777/
```

С другой машины в той же подсети:

```text
http://SERVER_IP:3777/
```

Пример:

```text
http://192.168.1.108:3777/
```

## 8. Управление службой

Перезапустить:

```powershell
Restart-Service AuditorDashboard
```

Остановить:

```powershell
Stop-Service AuditorDashboard
```

Запустить:

```powershell
Start-Service AuditorDashboard
```

Удалить:

```powershell
Stop-Service AuditorDashboard
C:\projects\bin\nssm.exe remove AuditorDashboard confirm
```

## 9. Логи

Логи службы:

```powershell
C:\projects\logs\auditor-dashboard-service.out.log
C:\projects\logs\auditor-dashboard-service.err.log
```

Логи admin-runner:

```powershell
C:\projects\windows-server-profile\logs\
```

## 10. Поведение во время работы

- CPU: живое измерение средствами Node.js.
- RAM: живое измерение средствами Node.js, без PowerShell.
- GPU: прямой счетчик производительности Windows. На некоторых машинах один замер занимает 1-3 секунды.
- Диски: данные логических дисков Windows CIM.
- npm-зависимости не требуются.
