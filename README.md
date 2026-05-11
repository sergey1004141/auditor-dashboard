# Auditor Dashboard / Windows Project Watch MCP

Small Windows MCP/HTTP server for monitoring project changes and displaying a compact system dashboard.

The dashboard shows live CPU, RAM, GPU, and disk usage. It can run independently from Codex as a Windows service.

## Tools

- `configure_project` - set the folder to monitor.
- `project_status` - return watcher state, snapshot changes, recent events, and optional git summary.
- `list_recent_changes` - show recent file-system events.
- `read_changed_file` - read a small changed text file from the project.
- `reset_baseline` - accept the current file state as the new baseline.

## Run

```powershell
node "C:\projects\src\server.js"
```

## Browser Dashboard

```powershell
node "C:\projects\src\server.js" --web --port 3777
```

For access from the local `192.168.1.x` subnet only:

```powershell
node "C:\projects\src\server.js" --web --host 0.0.0.0 --port 3777 --allow-subnet 192.168.1.
```

Then open:

```text
http://127.0.0.1:3777
```

## Windows Service Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full step-by-step setup.

Short version:

```powershell
winget install --source winget --accept-source-agreements --accept-package-agreements --id OpenJS.NodeJS.LTS --exact
winget install --source winget --accept-source-agreements --accept-package-agreements --id NSSM.NSSM --exact
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\22-enable-dashboard-firewall.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\projects\windows-server-profile\23-install-dashboard-service.ps1
```

For an MCP client, point it at Node and this server file:

```json
{
  "mcpServers": {
    "project-watch": {
      "command": "node",
      "args": ["C:\\projects\\src\\server.js"],
      "env": {
        "PROJECT_WATCH_PATH": "C:\\path\\to\\your\\project"
      }
    }
  }
}
```

You can omit `PROJECT_WATCH_PATH` and call `configure_project` from the client instead.

## Structure

- `src/server.js` - entrypoint that starts MCP stdio mode or the browser dashboard.
- `src/core/ProjectMonitor.js` - project state, snapshots, watcher, and file reads.
- `src/core/FileSnapshot.js` - recursive scan and snapshot comparison.
- `src/core/GitService.js` - optional git summary.
- `src/core/ConfigStore.js` - saved project path.
- `src/mcp/ToolRegistry.js` - MCP tool definitions and handlers.
- `src/mcp/McpStdioServer.js` - MCP JSON-RPC framing over stdio.
- `src/web/DashboardServer.js` - HTTP API for the dashboard.
- `src/web/StaticFileServer.js` - static assets from `public/`.
- `public/index.html` - browser UI.

## Notes

- No npm packages are required; this server uses only built-in Node modules.
- Recursive `fs.watch` works on Windows. If watching fails, `project_status` still detects changes by comparing snapshots.
- Large/generated folders are ignored by default: `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, and similar.
- Git support is optional. If `git` is not in PATH, the server still monitors files.
