import path from "node:path";
import { DEFAULT_IGNORES } from "../config.js";

export class PathRules {
  constructor(ignoredNames = DEFAULT_IGNORES) {
    this.ignoredNames = ignoredNames;
  }

  normalizeRelative(filePath) {
    return filePath.split(path.sep).join("/");
  }

  isIgnored(relativePath) {
    const parts = this.normalizeRelative(relativePath).split("/");
    return parts.some((part) => this.ignoredNames.has(part));
  }

  resolveInside(root, relativePath) {
    const absolute = path.resolve(root, relativePath);
    const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

    if (!absolute.startsWith(rootWithSeparator) && absolute !== root) {
      throw new Error("File path must stay inside the configured project.");
    }

    return absolute;
  }
}
