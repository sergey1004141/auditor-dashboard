export class ToolRegistry {
  constructor(projectMonitor, systemStatusService = null, rulesMonitor = null) {
    this.projectMonitor = projectMonitor;
    this.systemStatusService = systemStatusService;
    this.rulesMonitor = rulesMonitor;
  }

  list() {
    return [
      {
        name: "configure_project",
        description: "Set the Windows project directory to monitor and start a recursive watcher.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Absolute or relative path to a project directory.",
            },
          },
          required: ["projectPath"],
          additionalProperties: false,
        },
      },
      {
        name: "project_status",
        description:
          "Return current project watcher status, snapshot changes, recent file events, and git summary when available.",
        inputSchema: {
          type: "object",
          properties: {
            includeGit: { type: "boolean", default: true },
            refreshSnapshot: { type: "boolean", default: true },
          },
          additionalProperties: false,
        },
      },
      {
        name: "list_recent_changes",
        description: "List recent filesystem events captured by the watcher.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", minimum: 1, maximum: 100, default: 30 },
          },
          additionalProperties: false,
        },
      },
      {
        name: "read_changed_file",
        description:
          "Read a small text file from the configured project. Useful after a changed file appears in project_status.",
        inputSchema: {
          type: "object",
          properties: {
            relativePath: {
              type: "string",
              description: "File path relative to the configured project root.",
            },
            maxBytes: { type: "number", minimum: 1, maximum: 200000, default: 50000 },
          },
          required: ["relativePath"],
          additionalProperties: false,
        },
      },
      {
        name: "reset_baseline",
        description: "Reset the file snapshot baseline to the current project state.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "system_summary",
        description: "Return Windows host summary: OS, uptime, memory, CPU, and disks.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "runtime_metrics",
        description: "Return lightweight current CPU, memory, disk, and uptime metrics for dashboard polling.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "cpu_metrics",
        description: "Return current CPU usage metric.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "memory_metrics",
        description: "Return current RAM used, free, total, and percentage metrics.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "disk_metrics",
        description: "Return current fixed disk used, free, total, and percentage metrics.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "gpu_metrics",
        description: "Return current GPU usage and controller information.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "system_services",
        description: "Return status for important Windows services, or selected service names.",
        inputSchema: {
          type: "object",
          properties: {
            names: {
              type: "array",
              items: { type: "string" },
              description: "Optional service names to query.",
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: "rdp_status",
        description: "Return Remote Desktop configuration, listener, firewall, and allowed users.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "network_status",
        description: "Return network profiles, IPv4 addresses, and listening TCP ports.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "power_status",
        description: "Return active Windows power plan and sleep settings.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "recent_system_events",
        description: "Return recent critical, error, and warning events from the System log.",
        inputSchema: {
          type: "object",
          properties: {
            hours: { type: "number", minimum: 1, maximum: 168, default: 24 },
            maxEvents: { type: "number", minimum: 1, maximum: 100, default: 30 },
          },
          additionalProperties: false,
        },
      },
      {
        name: "configure_rules_monitor",
        description: "Configure a folder with AI role rules for contradiction and loophole monitoring.",
        inputSchema: {
          type: "object",
          properties: {
            rulesPath: {
              type: "string",
              description: "Local or UNC path to a folder with rule files.",
            },
            rulesFile: {
              type: "string",
              description: "Local or UNC path to one exact rule file.",
            },
            role: {
              type: "string",
              description: "Role name for this rules set, for example Developer.",
              default: "Developer",
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: "rules_status",
        description: "Return current AI rules monitoring status, changed files, contradictions, and loopholes.",
        inputSchema: {
          type: "object",
          properties: {
            updateBaseline: { type: "boolean", default: true },
          },
          additionalProperties: false,
        },
      },
    ];
  }

  async call(name, args = {}) {
    switch (name) {
      case "configure_project":
        return this.result(await this.projectMonitor.configure(args.projectPath));
      case "project_status":
        return this.result(
          await this.projectMonitor.status({
            includeGit: args.includeGit !== false,
            refreshSnapshot: args.refreshSnapshot !== false,
          }),
        );
      case "list_recent_changes":
        return this.result(await this.projectMonitor.recentChanges(args.limit ?? 30));
      case "read_changed_file":
        return this.result(
          await this.projectMonitor.readChangedFile(args.relativePath, args.maxBytes ?? 50000),
        );
      case "reset_baseline":
        return this.result(await this.projectMonitor.resetBaseline());
      case "system_summary":
        return this.result(await this.requireSystemStatus().summary());
      case "runtime_metrics":
        return this.result(await this.requireSystemStatus().runtimeMetrics());
      case "cpu_metrics":
        return this.result(await this.requireSystemStatus().cpuMetrics());
      case "memory_metrics":
        return this.result(await this.requireSystemStatus().memoryMetrics());
      case "disk_metrics":
        return this.result(await this.requireSystemStatus().diskMetrics());
      case "gpu_metrics":
        return this.result(await this.requireSystemStatus().gpuMetrics());
      case "system_services":
        return this.result(await this.requireSystemStatus().services(args.names ?? []));
      case "rdp_status":
        return this.result(await this.requireSystemStatus().rdpStatus());
      case "network_status":
        return this.result(await this.requireSystemStatus().networkStatus());
      case "power_status":
        return this.result(await this.requireSystemStatus().powerStatus());
      case "recent_system_events":
        return this.result(
          await this.requireSystemStatus().recentEvents({
            hours: args.hours ?? 24,
            maxEvents: args.maxEvents ?? 30,
          }),
        );
      case "configure_rules_monitor":
        return this.result(
          await this.requireRulesMonitor().configure(args.rulesPath, args.role, args.rulesFile),
        );
      case "rules_status":
        return this.result(
          await this.requireRulesMonitor().status({
            updateBaseline: args.updateBaseline !== false,
          }),
        );
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  requireSystemStatus() {
    if (!this.systemStatusService) {
      throw new Error("System status service is not configured.");
    }
    return this.systemStatusService;
  }

  requireRulesMonitor() {
    if (!this.rulesMonitor) {
      throw new Error("Rules monitor is not configured.");
    }
    return this.rulesMonitor;
  }

  result(value) {
    return {
      content: [
        {
          type: "text",
          text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
        },
      ],
    };
  }
}
