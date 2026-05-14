import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_SNAPSHOT_FILES } from "../config.js";

const { readdir, stat } = fs;

export class FileSnapshot {
  constructor(pathRules, maxFiles = MAX_SNAPSHOT_FILES) {
    this.pathRules = pathRules;
    this.maxFiles = maxFiles;
  }

  async scan(root, current = root, result = new Map()) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      if (!relative || this.pathRules.isIgnored(relative)) continue;

      if (entry.isDirectory()) {
        await this.scan(root, absolute, result);
        continue;
      }

      if (!entry.isFile()) continue;
      if (result.size >= this.maxFiles) {
        throw new Error(`Too many files to snapshot. Limit is ${this.maxFiles}.`);
      }

      const info = await stat(absolute);
      result.set(this.pathRules.normalizeRelative(relative), {
        size: info.size,
        mtimeMs: info.mtimeMs,
      });
    }
    return result;
  }

  compare(before, after) {
    const added = [];
    const modified = [];
    const deleted = [];

    for (const [file, metadata] of after.entries()) {
      const previous = before.get(file);
      if (!previous) {
        added.push(file);
      } else if (previous.size !== metadata.size || previous.mtimeMs !== metadata.mtimeMs) {
        modified.push(file);
      }
    }

    for (const file of before.keys()) {
      if (!after.has(file)) deleted.push(file);
    }

    return { added, modified, deleted };
  }
}
