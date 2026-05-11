import { createServer } from "node:http";
import { StaticFileServer } from "./StaticFileServer.js";

export class DashboardServer {
  constructor(
    toolRegistry,
    {
      host = process.env.HOST ?? "127.0.0.1",
      port = 3777,
      allowedSubnet = process.env.PROJECT_WATCH_ALLOWED_SUBNET ?? "192.168.1.",
    } = {},
  ) {
    this.toolRegistry = toolRegistry;
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
          this.callToolJson("system_summary", {}),
          this.callToolJson("system_services", {}),
          this.callToolJson("rdp_status", {}),
          this.callToolJson("network_status", {}),
          this.callToolJson("power_status", {}),
          this.callToolJson("recent_system_events", { hours: 24, maxEvents: 12 }),
        ]);
        this.sendJson(response, 200, { summary, services, rdp, network, power, events });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/rules") {
        await this.sendToolResult(response, "rules_status", {
          updateBaseline: url.searchParams.get("baseline") !== "false",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics") {
        this.sendJson(response, 200, await this.getCachedTool("runtime_metrics"));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/cpu") {
        this.sendJson(response, 200, await this.callToolJson("cpu_metrics", {}));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/memory") {
        this.sendJson(response, 200, await this.callToolJson("memory_metrics", {}));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/disks") {
        this.sendJson(response, 200, await this.callToolJson("disk_metrics", {}));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/metrics/gpu") {
        this.sendJson(response, 200, await this.callToolJson("gpu_metrics", {}));
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

  async getCachedTool(toolName) {
    const cache = this.metricsCache[toolName];
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
      cache.pending = this.callToolJson(toolName, {})
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
}
