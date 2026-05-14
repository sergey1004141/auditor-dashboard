# Auditor Dashboard / Windows Project Watch MCP

Небольшой MCP/HTTP-сервер для Windows. Он умеет отслеживать изменения в проекте и показывать компактный дашборд состояния системы.

Дашборд показывает текущую нагрузку CPU, оперативной памяти, GPU и состояние дисков. Сервер может работать независимо от Codex как обычная служба Windows.

Дополнительно дашборд умеет следить за конкретным файлом правил ИИ, например для роли `Developer`, и подсвечивать возможные противоречия, ослабления ограничений и лазейки.

## Инструменты MCP

- `configure_project` - задать папку проекта для мониторинга.
- `project_status` - вернуть состояние наблюдателя, изменения снимка, последние события и опционально сводку Git.
- `list_recent_changes` - показать последние изменения файловой системы.
- `read_changed_file` - прочитать небольшой измененный текстовый файл из проекта.
- `reset_baseline` - принять текущее состояние файлов как новую базовую линию.
- `configure_rules_monitor` - настроить файл правил ИИ и имя роли.
- `rules_status` - вернуть статус мониторинга правил, изменения файлов, противоречия и потенциальные лазейки.

## Запуск MCP-сервера

```powershell
node "C:\projects\MCP_analitic\src\server.js"
```

## Запуск веб-дашборда

```powershell
node "C:\projects\MCP_analitic\src\server.js" --web --port 3777
```

Для доступа только из локальной подсети `192.168.88.x`:

```powershell
node "C:\projects\MCP_analitic\src\server.js" --web --host 0.0.0.0 --port 3777 --allow-subnet 192.168.88.
```

Открыть локально:

```text
http://127.0.0.1:3777
```

## Развертка как службы Windows

Полная пошаговая инструкция находится в [DEPLOYMENT.md](DEPLOYMENT.md).

Короткий вариант:

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --id OpenJS.NodeJS.LTS --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --id NSSM.NSSM --exact
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\22-enable-dashboard-firewall.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\23-install-dashboard-service.ps1
```

## Мониторинг правил ИИ

На дашборде есть блок `Правила ИИ`. В нем можно указать:

- роль, например `Developer`;
- путь к конкретному файлу правил, включая UNC-путь вида `\\PC\share\rules\developer.rules`.

Сервер перечитывает файл, сравнивает его с предыдущим снимком и показывает:

- добавленные, измененные и удаленные файлы;
- возможные противоречия между требованиями и запретами;
- новые исключения или ослабления ограничений;
- формулировки, похожие на обход правил.

Если путь сетевой, служба Windows должна иметь права чтения этого файла. По умолчанию `AuditorDashboard` работает как `LocalSystem`, а такая учетная запись не всегда имеет доступ к шарам другого ПК в рабочей группе.

## Подключение к MCP-клиенту

Для MCP-клиента укажите Node и путь к серверу:

```json
{
  "mcpServers": {
    "project-watch": {
      "command": "node",
      "args": ["C:\\projects\\MCP_analitic\\src\\server.js"],
      "env": {
        "PROJECT_WATCH_PATH": "C:\\path\\to\\your\\project"
      }
    }
  }
}
```

`PROJECT_WATCH_PATH` можно не указывать и затем вызвать `configure_project` из клиента.

## Структура проекта

- `src/server.js` - точка входа, запускает MCP stdio-режим или веб-дашборд.
- `src/core/ProjectMonitor.js` - состояние проекта, снимки, наблюдатель и чтение файлов.
- `src/core/FileSnapshot.js` - рекурсивное сканирование и сравнение снимков.
- `src/core/GitService.js` - опциональная сводка Git.
- `src/core/ConfigStore.js` - сохраненный путь проекта.
- `src/mcp/ToolRegistry.js` - определения и обработчики MCP-инструментов.
- `src/mcp/McpStdioServer.js` - JSON-RPC обмен MCP через stdio.
- `src/web/DashboardServer.js` - HTTP API для дашборда.
- `src/web/StaticFileServer.js` - статические файлы из `public/`.
- `public/index.html` - браузерный интерфейс.

## Примечания

- npm-пакеты не требуются, сервер использует только встроенные модули Node.js.
- Рекурсивный `fs.watch` работает на Windows. Если наблюдение недоступно, `project_status` все равно находит изменения сравнением снимков.
- Крупные и генерируемые папки игнорируются по умолчанию: `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage` и похожие.
- Поддержка Git опциональна. Если `git` отсутствует в `PATH`, сервер все равно мониторит файлы.
