import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR, CONFIG_FILE } from "../config.js";

const { mkdir, readFile, writeFile } = fs;

export class ConfigStore {
  constructor({ configDir = CONFIG_DIR, configFile = CONFIG_FILE, disabled = false } = {}) {
    this.configDir = configDir;
    this.configFile = configFile;
    this.disabled = disabled;
  }

  async load() {
    if (this.disabled) return {};

    try {
      const raw = await readFile(this.configFile, "utf8");
      const parsed = JSON.parse(raw);
      return {
        projectPath: parsed.projectPath ? path.resolve(parsed.projectPath) : null,
        rulesPath: parsed.rulesPath ? path.resolve(parsed.rulesPath) : null,
        rulesFile: parsed.rulesFile ? path.resolve(parsed.rulesFile) : null,
        rulesRole: parsed.rulesRole ?? null,
        lastConfiguredAt: parsed.lastConfiguredAt ?? null,
        rulesConfiguredAt: parsed.rulesConfiguredAt ?? null,
      };
    } catch {
      return {};
    }
  }

  async save(nextConfig) {
    if (this.disabled) return;

    const current = await this.load();
    const merged = {
      ...current,
      ...nextConfig,
    };

    await mkdir(this.configDir, { recursive: true });
    await writeFile(
      this.configFile,
      JSON.stringify(
        merged,
        null,
        2,
      ),
    );
  }
}
