import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(file = path.join(APP_ROOT, ".env")) {
  try {
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      const value = rawValue.replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  } catch {
    // .env is optional; service scripts can still pass environment variables directly.
  }
}

loadEnvFile();

export const SERVER_NAME = "windows-project-watch";
export const SERVER_VERSION = "0.1.0";
export const PROTOCOL_VERSION = "2024-11-05";
export const MAX_SNAPSHOT_FILES = 15000;
export const MAX_RECENT_EVENTS = 300;
export const CONFIG_DIR = process.env.AUDITOR_CONFIG_DIR ?? path.join(APP_ROOT, "logs", "state");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const RULES_BASELINE_FILE = path.join(CONFIG_DIR, "rules-baseline.json");
export const RULES_REVIEW_QUEUE_FILE = path.join(CONFIG_DIR, "rules-review-queue.json");
export const RULES_REVIEW_DIR = process.env.AUDITOR_RULES_REVIEW_DIR ?? path.join(CONFIG_DIR, "rules-review");
export const RULES_REVIEW_HISTORY_FILE = process.env.AUDITOR_RULES_REVIEW_HISTORY_FILE ?? path.join(CONFIG_DIR, "rules-review-history.json");
export const RULES_NOTIFICATION_DIR = process.env.AUDITOR_RULES_NOTIFICATION_DIR ?? path.join(CONFIG_DIR, "rules-notifications");
export const PUBLIC_DIR = path.join(APP_ROOT, "public");

export const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);
