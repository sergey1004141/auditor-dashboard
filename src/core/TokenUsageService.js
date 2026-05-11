import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const { readdir, readFile, stat } = fs;
const MAX_LOG_BYTES = 25000000;

export class TokenUsageService {
  constructor({
    codexHome = process.env.CODEX_HOME,
  } = {}) {
    this.codexHome = codexHome ?? this.resolveCodexHome();
    this.roots = [
      path.join(this.codexHome, "sessions"),
      path.join(this.codexHome, "archived_sessions"),
    ];
  }

  async status() {
    const files = await this.sessionFiles();
    const todayStart = this.startOfToday();
    let latest = null;
    const daily = this.emptyUsage();
    let dailySessions = 0;

    for (const file of files) {
      const info = await stat(file);
      if (info.size > MAX_LOG_BYTES) continue;
      if (info.mtime < todayStart) continue;

      const parsed = await this.parseSessionFile(file, todayStart);
      if (!parsed.latest) continue;

      if (!latest || parsed.latest.timestamp > latest.timestamp) {
        latest = parsed.latest;
      }

      if (parsed.todayUsage) {
        dailySessions += 1;
        this.addUsage(daily, parsed.todayUsage);
      }
    }

    if (!latest) {
      return {
        available: false,
        message: "Локальные события token_count за сегодня не найдены.",
        sampledAt: new Date().toISOString(),
      };
    }

    const primary = this.formatLimit(latest.rateLimits?.primary);
    const secondary = this.formatLimit(latest.rateLimits?.secondary);
    const visible = primary ?? secondary;

    return {
      available: true,
      sampledAt: latest.timestamp.toISOString(),
      percent: visible?.usedPercent ?? null,
      percentFormatted: visible ? `${visible.usedPercent.toFixed(3)}%` : "n/a",
      percentSource: primary ? "primary" : secondary ? "secondary" : null,
      note: primary?.windowMinutes === 1440
        ? "Дневной лимит из Codex token_count."
        : "Точного дневного процента в локальных логах нет; показан последний процент лимита Codex.",
      rateLimits: {
        primary,
        secondary,
      },
      today: {
        sessions: dailySessions,
        totalTokens: daily.total_tokens,
        inputTokens: daily.input_tokens,
        cachedInputTokens: daily.cached_input_tokens,
        outputTokens: daily.output_tokens,
        reasoningOutputTokens: daily.reasoning_output_tokens,
      },
    };
  }

  async sessionFiles() {
    const files = [];
    for (const root of this.roots) {
      await this.collectJsonl(root, files);
    }
    return files;
  }

  async collectJsonl(current, files) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await this.collectJsonl(absolute, files);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(absolute);
      }
    }
  }

  async parseSessionFile(file, todayStart) {
    const raw = await readFile(file, "utf8");
    let latest = null;
    let todayUsage = null;

    for (const line of raw.split(/\r?\n/)) {
      if (!line.includes('"token_count"')) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      const timestamp = new Date(event.timestamp);
      if (Number.isNaN(timestamp.getTime()) || timestamp < todayStart) continue;

      const payload = event.payload;
      if (payload?.type !== "token_count") continue;

      const usage = payload.info?.total_token_usage;
      if (usage) todayUsage = this.normalizeUsage(usage);

      const candidate = {
        timestamp,
        usage: this.normalizeUsage(usage),
        rateLimits: payload.rate_limits ?? null,
      };

      if (!latest || candidate.timestamp > latest.timestamp) {
        latest = candidate;
      }
    }

    return { latest, todayUsage };
  }

  formatLimit(limit) {
    if (!limit || typeof limit.used_percent !== "number") return null;
    return {
      usedPercent: limit.used_percent,
      usedPercentFormatted: `${limit.used_percent.toFixed(3)}%`,
      windowMinutes: limit.window_minutes ?? null,
      resetsAt: limit.resets_at ? new Date(limit.resets_at * 1000).toISOString() : null,
    };
  }

  normalizeUsage(usage = {}) {
    return {
      input_tokens: Number(usage.input_tokens ?? 0),
      cached_input_tokens: Number(usage.cached_input_tokens ?? 0),
      output_tokens: Number(usage.output_tokens ?? 0),
      reasoning_output_tokens: Number(usage.reasoning_output_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
    };
  }

  emptyUsage() {
    return this.normalizeUsage();
  }

  addUsage(target, source) {
    for (const key of Object.keys(target)) {
      target[key] += Number(source[key] ?? 0);
    }
  }

  startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  resolveCodexHome() {
    const homeCandidate = path.join(os.homedir(), ".codex");
    if (!os.homedir().includes("systemprofile")) return homeCandidate;

    return process.env.AUDITOR_CODEX_HOME ?? "C:\\Users\\user\\.codex";
  }
}
