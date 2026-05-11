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
    let currentThreadLatest = null;
    const daily = this.emptyUsage();
    let dailySessions = 0;
    let currentThreadId = process.env.CODEX_THREAD_ID ?? null;

    for (const file of files) {
      const info = await stat(file);
      if (info.size > MAX_LOG_BYTES) continue;
      if (info.mtime < todayStart) continue;

      const parsed = await this.parseSessionFile(file, todayStart, currentThreadId);
      if (!parsed.latest) continue;

      if (!latest || parsed.latest.timestamp > latest.timestamp) {
        latest = parsed.latest;
      }

      if (parsed.threadLatest && (!currentThreadLatest || parsed.threadLatest.timestamp > currentThreadLatest.timestamp)) {
        currentThreadLatest = parsed.threadLatest;
      }

      if (!currentThreadId && parsed.latest && (!currentThreadLatest || parsed.latest.timestamp > currentThreadLatest.timestamp)) {
        currentThreadId = parsed.threadId;
        currentThreadLatest = parsed.latest;
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
      currentThread: this.formatThreadUsage(currentThreadLatest, currentThreadId),
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

  async parseSessionFile(file, todayStart, currentThreadId = null) {
    const raw = await readFile(file, "utf8");
    let latest = null;
    let todayUsage = null;
    let threadId = null;
    let threadLatest = null;

    for (const line of raw.split(/\r?\n/)) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.type === "session_meta" && event.payload?.id) {
        threadId = event.payload.id;
        continue;
      }

      if (event.payload?.type === "session_meta" && event.payload?.id) {
        threadId = event.payload.id;
        continue;
      }

      const timestamp = new Date(event.timestamp);
      if (Number.isNaN(timestamp.getTime()) || timestamp < todayStart) continue;

      const payload = event.payload;
      if (payload?.type !== "token_count") continue;

      const usage = payload.info?.total_token_usage;
      const lastUsage = payload.info?.last_token_usage;
      if (usage) todayUsage = this.normalizeUsage(usage);

      const candidate = {
        timestamp,
        usage: this.normalizeUsage(usage),
        lastUsage: this.normalizeUsage(lastUsage),
        rateLimits: payload.rate_limits ?? null,
        modelContextWindow: Number(payload.info?.model_context_window ?? 0),
      };

      if (!latest || candidate.timestamp > latest.timestamp) {
        latest = candidate;
      }

      if (currentThreadId && threadId === currentThreadId) {
        threadLatest = candidate;
      }
    }

    return { latest, todayUsage, threadLatest, threadId };
  }

  formatLimit(limit) {
    if (!limit || typeof limit.used_percent !== "number") return null;
    const usedPercent = Math.max(0, Math.min(100, limit.used_percent));
    const remainingPercent = Math.max(0, 100 - usedPercent);
    const resetsAt = limit.resets_at ? new Date(limit.resets_at * 1000) : null;
    return {
      usedPercent,
      usedPercentFormatted: `${usedPercent.toFixed(3)}%`,
      remainingPercent,
      remainingPercentFormatted: `${remainingPercent.toFixed(3)}%`,
      windowMinutes: limit.window_minutes ?? null,
      label: this.formatWindowLabel(limit.window_minutes),
      resetsAt: resetsAt ? resetsAt.toISOString() : null,
      resetsAtTime: this.formatClock(resetsAt),
      resetsIn: this.formatRemaining(resetsAt),
    };
  }

  formatWindowLabel(windowMinutes) {
    if (windowMinutes === 300) return "5ч";
    if (windowMinutes === 10080) return "Еженедельно";
    if (windowMinutes === 1440) return "Сутки";
    if (!windowMinutes) return "Лимит";
    if (windowMinutes % 60 === 0) return `${windowMinutes / 60}ч`;
    return `${windowMinutes}м`;
  }

  formatRemaining(target) {
    if (!target) return null;
    const totalMinutes = Math.max(0, Math.ceil((target.getTime() - Date.now()) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  formatClock(target) {
    if (!target) return null;
    return `${String(target.getHours()).padStart(2, "0")}:${String(target.getMinutes()).padStart(2, "0")}`;
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

  formatThreadUsage(latest, threadId) {
    if (!latest) {
      return {
        available: false,
        threadId,
        message: "Текущая беседа не найдена в локальных token_count логах.",
      };
    }

    const totalTokens = latest.usage.total_tokens;

    return {
      available: true,
      threadId,
      sampledAt: latest.timestamp.toISOString(),
      totalTokens,
      totalTokensFormatted: this.formatCompactTokens(totalTokens),
      inputTokens: latest.usage.input_tokens,
      cachedInputTokens: latest.usage.cached_input_tokens,
      outputTokens: latest.usage.output_tokens,
      reasoningOutputTokens: latest.usage.reasoning_output_tokens,
      lastTotalTokens: latest.lastUsage.total_tokens,
      lastTotalTokensFormatted: this.formatCompactTokens(latest.lastUsage.total_tokens),
      modelContextWindow: latest.modelContextWindow || null,
    };
  }

  formatCompactTokens(value) {
    const tokens = Number(value ?? 0);
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return String(tokens);
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
