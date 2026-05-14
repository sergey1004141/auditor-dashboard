#!/usr/bin/env node
import { ProjectMonitor } from "./core/ProjectMonitor.js";
import { RulesMonitor } from "./core/RulesMonitor.js";
import { SystemStatusService } from "./core/SystemStatusService.js";
import { TaskHistoryService } from "./core/TaskHistoryService.js";
import { TokenUsageService } from "./core/TokenUsageService.js";
import { McpStdioServer } from "./mcp/McpStdioServer.js";
import { ToolRegistry } from "./mcp/ToolRegistry.js";
import { DashboardServer } from "./web/DashboardServer.js";

function readPort() {
  const portIndex = process.argv.indexOf("--port");
  return portIndex >= 0 ? Number(process.argv[portIndex + 1]) : Number(process.env.PORT ?? 3777);
}

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const projectMonitor = new ProjectMonitor();
await projectMonitor.initialize();
const rulesMonitor = new RulesMonitor();
await rulesMonitor.initialize();

const toolRegistry = new ToolRegistry(
  projectMonitor,
  new SystemStatusService(),
  rulesMonitor,
  new TokenUsageService(),
  new TaskHistoryService(),
);

process.on("SIGINT", () => {
  projectMonitor.stopWatcher();
  process.exit(0);
});

process.on("SIGTERM", () => {
  projectMonitor.stopWatcher();
  process.exit(0);
});

if (process.argv.includes("--web")) {
  new DashboardServer(toolRegistry, {
    host: readOption("--host", process.env.HOST ?? "127.0.0.1"),
    port: readPort(),
    allowedSubnet: readOption(
      "--allow-subnet",
      process.env.PROJECT_WATCH_ALLOWED_SUBNET ?? "192.168.1.",
    ),
  }).start();
} else {
  new McpStdioServer(toolRegistry).start();
}
