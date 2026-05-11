import { PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } from "../config.js";

export class McpStdioServer {
  constructor(toolRegistry, { input = process.stdin, output = process.stdout } = {}) {
    this.toolRegistry = toolRegistry;
    this.input = input;
    this.output = output;
    this.buffer = Buffer.alloc(0);
  }

  start() {
    this.input.on("data", (chunk) => this.receive(chunk));
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        return;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.subarray(bodyEnd);

      try {
        void this.dispatch(JSON.parse(body));
      } catch (error) {
        this.send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: error.message },
        });
      }
    }
  }

  async dispatch(message) {
    if (message.id === undefined || message.id === null) {
      await this.handleRequest(message);
      return;
    }

    try {
      const result = await this.handleRequest(message);
      this.send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: error.message,
        },
      });
    }
  }

  async handleRequest(message) {
    switch (message.method) {
      case "initialize":
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        };
      case "tools/list":
        return { tools: this.toolRegistry.list() };
      case "tools/call":
        return this.toolRegistry.call(message.params?.name, message.params?.arguments ?? {});
      case "ping":
        return {};
      default:
        if (message.method?.startsWith("notifications/")) return undefined;
        throw new Error(`Unsupported method: ${message.method}`);
    }
  }

  send(payload) {
    const body = JSON.stringify(payload);
    const frame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
    this.output.write(frame);
  }
}
