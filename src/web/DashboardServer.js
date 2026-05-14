import { createServer } from "node:http";
import { StaticFileServer } from "./StaticFileServer.js";

export class DashboardServer {
  constructor(
    toolRegistry,
    {
      host = process.env.HOST ?? "127.0.0.1",
      port = 3777,
      allowedSubnet = process.env.PROJECT_WATCH_ALLOWED_SUBNET ?? "192.168.1.",
      rulesMonitor = null,
      systemStatusService = null,
      tokenUsageService = null,
      taskHistoryService = null,
    } = {},
  ) {
    this.toolRegistry = toolRegistry;
    this.rulesMonitor = rulesMonitor;
    this.systemStatusService = systemStatusService;
    this.tokenUsageService = tokenUsageService;
    this.taskHistoryService = taskHistoryService;
    this.host = host;
    this.port = port;
    this.allowedSubnet = allowedSubnet;
    this.staticFiles = new StaticFileServer();
    this.httpServer = null;
    this.metricsCache = {
      runtime_metrics: this.createCache(1000),
    };
  }

  start() {
    this.httpServer = createServer((request, response) => {
      void this.handle(request, response);
    });

    this.httpServer.listen(this.port, this.host, () => {
      console.log(`Project Watch dashboard: http://${this.host}:${this.port}`);
    });
  }

  async handle(request, response) {
    if (!this.isAllowedRemote(request.socket.remoteAddress)) {
      this.sendJson(response, 403, { error: "Forbidden: remote address is outside the allowed subnet." });
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");

    try {
      if (request.method === "POST" && url.pathname === "/api/configure") {
        const body = await this.readRequestJson(request);
        await this.sendToolResult(response, "configure_project", { projectPath: body.projectPath });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rules/configure") {
        const body = await this.readRequestJson(request);
        await this.sendToolResult(response, "configure_rules_monitor", {
          rulesPath: body.rulesPath,
          rulesFile: body.rulesFile,
          role: body.role,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        await this.sendToolResult(response, "project_status", {
          includeGit: url.searchParams.get("git") !== "false",
          refreshSnapshot: url.searchParams.get("refresh") !== "false",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        await this.sendToolResult(response, "list_recent_changes", {
          limit: Number(url.searchParams.get("limit") ?? 30),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/reset") {
        await this.sendToolResult(response, "reset_baseline", {});
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/system") {
        const [summary, services, rdp, network, power, events] = await Promise.all([
          this.requireSystemStatus().summary(),
          this.requireSystemStatus().services(),
          this.requireSystemStatus().rdpStatus(),
          this.requireSystemStatus().networkStatus(),
          this.requireSystemStatus().powerStatus(),
          this.requireSystemStatus().recentEvents({ hours: 24, maxEvents: 12 }),
        ]);
        this.sendJson(response, 200, { summary, services, rdp, network, power, events });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/rules") {
        this.sendJson(response, 200, await this.requireRulesMonitor().status({
          updateBaseline: url.searchParams.get("baseline") !== "false",
        }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/rules/review-package") {
        this.sendJson(response, 200, await this.requireRulesMonitor().pendingReview({
          complete: url.searchParams.get("complete") === "true",
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/rules/review-package/complete") {
        this.sendJson(response, 200, await this.requireRulesMonitor().completeReview());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/tasks") {
        this.sendJson(response, 200, await this.requireTaskHistory().status());
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/tasks/history/")) {
        const encodedName = url.pathname.slice("/api/tasks/history/".length);
        const task = decodeURIComponent(encodedName).replace(/\.md$/i, "");
        const history = await this.requireTaskHistory().readHistory(task);
        this.sendText(response, 200, history.content, {
          "content-type": "text/markdown; charset=utf-8",
          "x-task-history-path": history.path,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics") {
        this.sendJson(response, 200, await this.getCachedRuntimeMetrics());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/cpu") {
        this.sendJson(response, 200, await this.requireSystemStatus().cpuMetrics());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/memory") {
        this.sendJson(response, 200, await this.requireSystemStatus().memoryMetrics());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/disks") {
        this.sendJson(response, 200, await this.requireSystemStatus().diskMetrics());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/gpu") {
        this.sendJson(response, 200, await this.requireSystemStatus().gpuMetrics());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/tokens") {
        this.sendJson(response, 200, await this.requireTokenUsage().status());
        return;
      }

      if (request.method === "GET") {
        await this.staticFiles.serve(response, url.pathname);
        return;
      }

      this.sendJson(response, 405, { error: "Method not allowed" });
    } catch (error) {
      this.sendJson(response, 500, { error: error.message });
    }
  }

  isAllowedRemote(remoteAddress) {
    const address = this.normalizeRemoteAddress(remoteAddress);
    return (
      address === "127.0.0.1" ||
      address === "::1" ||
      address === "localhost" ||
      address.startsWith(this.allowedSubnet)
    );
  }

  normalizeRemoteAddress(remoteAddress = "") {
    if (remoteAddress.startsWith("::ffff:")) {
      return remoteAddress.slice("::ffff:".length);
    }
    return remoteAddress;
  }

  async sendToolResult(response, name, args) {
    this.sendJson(response, 200, await this.callToolJson(name, args));
  }

  requireTaskHistory() {
    if (!this.taskHistoryService) {
      throw new Error("Task history service is not configured.");
    }
    return this.taskHistoryService;
  }

  requireSystemStatus() {
    if (!this.systemStatusService) {
      throw new Error("System status service is not configured.");
    }
    return this.systemStatusService;
  }

  requireTokenUsage() {
    if (!this.tokenUsageService) {
      throw new Error("Token usage service is not configured.");
    }
    return this.tokenUsageService;
  }

  requireRulesMonitor() {
    if (!this.rulesMonitor) {
      throw new Error("Rules monitor is not configured.");
    }
    return this.rulesMonitor;
  }

  async callToolJson(name, args) {
    const result = await this.toolRegistry.call(name, args);
    return JSON.parse(result.content[0].text);
  }

  createCache(ttlMs) {
    return {
      value: null,
      updatedAt: 0,
      pending: null,
      ttlMs,
    };
  }

  async getCachedRuntimeMetrics() {
    const cache = this.metricsCache.runtime_metrics;
    const now = Date.now();
    if (cache.value && now - cache.updatedAt < cache.ttlMs) {
      return {
        ...cache.value,
        cache: {
          ageMs: now - cache.updatedAt,
          ttlMs: cache.ttlMs,
        },
      };
    }

    if (!cache.pending) {
      cache.pending = this.requireSystemStatus().runtimeMetrics()
        .then((value) => {
          cache.value = value;
          cache.updatedAt = Date.now();
          return value;
        })
        .finally(() => {
          cache.pending = null;
        });
    }

    if (cache.value) {
      return {
        ...cache.value,
        cache: {
          ageMs: now - cache.updatedAt,
          ttlMs: cache.ttlMs,
          refreshing: true,
        },
      };
    }

    return cache.pending;
  }

  async readRequestJson(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    return raw ? JSON.parse(raw) : {};
  }

  sendJson(response, status, payload) {
    const body = JSON.stringify(payload, null, 2);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  }

  sendText(response, status, payload, headers = {}) {
    response.writeHead(status, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    });
    response.end(payload);
  }
}
