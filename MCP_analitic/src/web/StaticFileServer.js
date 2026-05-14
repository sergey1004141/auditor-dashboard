import { promises as fs } from "node:fs";
import path from "node:path";
import { PUBLIC_DIR } from "../config.js";

const { readFile } = fs;

export class StaticFileServer {
  constructor(publicDir = PUBLIC_DIR) {
    this.publicDir = publicDir;
  }

  async serve(response, pathname) {
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const absolute = path.resolve(this.publicDir, relative);
    const publicRoot = this.publicDir.endsWith(path.sep) ? this.publicDir : `${this.publicDir}${path.sep}`;

    if (!absolute.startsWith(publicRoot) && absolute !== this.publicDir) {
      this.sendJson(response, 403, { error: "Forbidden" });
      return;
    }

    try {
      const content = await readFile(absolute);
      const extension = path.extname(absolute).toLowerCase();
      const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mp3": "audio/mpeg",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
      };
      response.writeHead(200, {
        "content-type": contentTypes[extension] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(content);
    } catch {
      this.sendJson(response, 404, { error: "Not found" });
    }
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
