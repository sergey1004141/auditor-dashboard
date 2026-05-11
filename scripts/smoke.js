import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

const fixture = path.join(os.tmpdir(), `project-watch-mcp-${Date.now()}`);
await fs.mkdir(fixture, { recursive: true });
await fs.writeFile(path.join(fixture, "hello.txt"), "hello\n", "utf8");

const child = spawn(process.execPath, [path.resolve("src/server.js")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    PROJECT_WATCH_DISABLE_CONFIG: "1",
  },
});

let nextId = 1;
let buffer = Buffer.alloc(0);
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) throw new Error(`Bad header: ${header}`);

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;

    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    const message = JSON.parse(body);
    const deferred = pending.get(message.id);
    if (!deferred) continue;
    pending.delete(message.id);
    if (message.error) deferred.reject(new Error(message.error.message));
    else deferred.resolve(message.result);
  }
});

function send(method, params) {
  const id = nextId++;
  const message = { jsonrpc: "2.0", id, method, params };
  const body = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), 5000).unref();
  });
}

function notify(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke-client", version: "0.1.0" },
});
notify("notifications/initialized", {});

const tools = await send("tools/list", {});
const toolNames = tools.tools.map((tool) => tool.name).sort();
for (const expected of ["configure_project", "project_status", "read_changed_file", "system_summary", "rdp_status"]) {
  if (!toolNames.includes(expected)) {
    throw new Error(`Missing tool: ${expected}`);
  }
}

await send("tools/call", {
  name: "configure_project",
  arguments: { projectPath: fixture },
});

await fs.writeFile(path.join(fixture, "hello.txt"), "hello again\n", "utf8");

const status = await send("tools/call", {
  name: "project_status",
  arguments: { includeGit: false, refreshSnapshot: true },
});

const payload = JSON.parse(status.content[0].text);
if (!payload.snapshotChanges.modified.includes("hello.txt")) {
  throw new Error(`Expected hello.txt to be modified. Got: ${status.content[0].text}`);
}

const summary = await send("tools/call", {
  name: "system_summary",
  arguments: {},
});
const systemPayload = JSON.parse(summary.content[0].text);
if (!systemPayload.computerName) {
  throw new Error(`Expected system summary. Got: ${summary.content[0].text}`);
}

child.kill();
await fs.rm(fixture, { recursive: true, force: true });
console.log("Smoke test passed.");
