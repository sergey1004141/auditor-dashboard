import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_NAME = "windows-project-watch";
export const SERVER_VERSION = "0.1.0";
export const PROTOCOL_VERSION = "2024-11-05";
export const MAX_SNAPSHOT_FILES = 15000;
export const MAX_RECENT_EVENTS = 300;
export const CONFIG_DIR = path.join(os.homedir(), ".windows-project-watch-mcp");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const RULES_BASELINE_FILE = path.join(CONFIG_DIR, "rules-baseline.json");
export const RULES_REVIEW_QUEUE_FILE = path.join(CONFIG_DIR, "rules-review-queue.json");
export const RULES_REVIEW_DIR = path.join(CONFIG_DIR, "rules-review");
export const RULES_REVIEW_HISTORY_FILE = path.join(CONFIG_DIR, "rules-review-history.json");
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
