import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  RULES_BASELINE_FILE,
  RULES_REVIEW_DIR,
  RULES_REVIEW_HISTORY_FILE,
  RULES_NOTIFICATION_DIR,
  RULES_REVIEW_QUEUE_FILE,
} from "../config.js";
import { ConfigStore } from "./ConfigStore.js";
import { RulesDiff } from "./RulesDiff.js";

const { mkdir, readFile, readdir, rm, stat, writeFile } = fs;

const RULE_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".rules"]);
const MAX_RULE_FILES = 500;
const MAX_RULE_FILE_BYTES = 300000;

export class RulesMonitor {
  constructor({
    initialRulesPath = process.env.AUDITOR_RULES_PATH,
    initialRulesFile = process.env.AUDITOR_RULES_FILE,
    initialRole = process.env.AUDITOR_RULES_ROLE ?? "Developer",
    configStore = new ConfigStore({
      disabled: process.env.PROJECT_WATCH_DISABLE_CONFIG === "1",
    }),
    baselineFile = RULES_BASELINE_FILE,
    reviewQueueFile = RULES_REVIEW_QUEUE_FILE,
    reviewDir = RULES_REVIEW_DIR,
    reviewHistoryFile = RULES_REVIEW_HISTORY_FILE,
    notificationDir = RULES_NOTIFICATION_DIR,
    rulesDiff = new RulesDiff(),
  } = {}) {
    this.rulesPath = initialRulesPath ? path.resolve(initialRulesPath) : null;
    this.rulesFile = initialRulesFile ? path.resolve(initialRulesFile) : null;
    this.rulesRole = initialRole;
    this.rulesConfiguredAt = null;
    this.configStore = configStore;
    this.baselineFile = baselineFile;
    this.reviewQueueFile = reviewQueueFile;
    this.reviewDir = reviewDir;
    this.reviewHistoryFile = reviewHistoryFile;
    this.notificationDir = notificationDir;
    this.completedNotificationsFile = path.join(notificationDir, "completed.json");
    this.rulesDiff = rulesDiff;
  }

  async initialize() {
    await this.loadConfig();
  }

  async configure(rulesPath, role = this.rulesRole, rulesFile = null) {
    if (rulesFile && typeof rulesFile === "string") {
      this.rulesFile = path.resolve(rulesFile);
      this.rulesPath = null;
    } else if (rulesPath && typeof rulesPath === "string") {
      this.rulesPath = path.resolve(rulesPath);
      this.rulesFile = null;
    } else {
      throw new Error("rulesPath or rulesFile is required.");
    }

    this.rulesRole = typeof role === "string" && role.trim() ? role.trim() : "Developer";
    this.rulesConfiguredAt = new Date().toISOString();
    await this.ensureSource();
    const scan = await this.scanRules();
    await this.saveBaseline(scan);
    await this.configStore.save({
      rulesPath: this.rulesPath,
      rulesFile: this.rulesFile,
      rulesRole: this.rulesRole,
      rulesConfiguredAt: this.rulesConfiguredAt,
    });

    return {
      ok: true,
      rulesPath: this.rulesPath,
      rulesFile: this.rulesFile,
      role: this.rulesRole,
      trackedFiles: scan.files.length,
      configuredAt: this.rulesConfiguredAt,
      accessNote: this.networkAccessNote(),
    };
  }

  async status({ updateBaseline = true, includeReviewText = true } = {}) {
    await this.loadConfig();
    if (!this.rulesPath && !this.rulesFile) {
      return {
        configured: false,
        status: "not-configured",
        role: this.rulesRole,
        message: "Путь к файлу правил не настроен.",
      };
    }

    try {
      await this.ensureSource();
      const previous = await this.loadBaseline();
      const scan = await this.scanRules();
      const changes = this.compare(previous.files ?? [], scan.files);
      const findings = this.analyze(scan.documents, changes);
      const freshReviewPackage = this.rulesDiff.build(previous.documents ?? [], scan.documents, changes);
      const reviewPackage = freshReviewPackage.available
        ? await this.saveReviewPackage(freshReviewPackage, { includeText: includeReviewText })
        : await this.pendingReview({ includeText: includeReviewText });
      const reviewHistory = await this.listReviewHistory();
      const ruleNotifications = await this.syncRuleNotifications({ findings, reviewHistory });

      if (updateBaseline) {
        await this.saveBaseline(scan);
      }

      return {
        configured: true,
        status: this.statusFromFindings(findings, changes),
        rulesPath: this.rulesPath,
        rulesFile: this.rulesFile,
        role: this.rulesRole,
        sampledAt: new Date().toISOString(),
        trackedFiles: scan.files.length,
        changes,
        findings,
        reviewPackage,
        reviewHistory,
        ruleNotifications,
        ruleNotificationsDir: this.notificationDir,
        accessNote: this.networkAccessNote(),
      };
    } catch (error) {
      const source = this.rulesFile ?? this.rulesPath;
      const findings = [
        {
          severity: "critical",
          type: "access",
          file: source,
          message: `Файл правил недоступен: ${error.message}`,
          text: source,
          suggestion: "Проверить сетевой путь, доступ учетной записи службы и доступность машины с файлом правил.",
        },
      ];
      return {
        configured: true,
        status: "error",
        rulesPath: this.rulesPath,
        rulesFile: this.rulesFile,
        role: this.rulesRole,
        sampledAt: new Date().toISOString(),
        error: error.message,
        changes: { added: [], modified: [], deleted: [] },
        reviewPackage: {
          ...this.emptyReviewPackage(),
          note: "Diff недоступен, потому что файл правил не читается.",
        },
        findings,
        ruleNotifications: await this.syncRuleNotifications({ findings, reviewHistory: [] }),
        ruleNotificationsDir: this.notificationDir,
        accessNote: this.networkAccessNote(),
      };
    }
  }

  async loadConfig() {
    if (this.rulesPath) return;
    const config = await this.configStore.load();
    if (config.rulesPath) {
      this.rulesPath = config.rulesPath;
    }
    if (config.rulesFile) {
      this.rulesFile = config.rulesFile;
      this.rulesPath = null;
    }
    this.rulesRole = config.rulesRole ?? this.rulesRole;
    this.rulesConfiguredAt = config.rulesConfiguredAt ?? null;
  }

  async ensureSource() {
    const source = this.rulesFile ?? this.rulesPath;
    const info = await stat(source);
    if (this.rulesFile && !info.isFile()) {
      throw new Error(`Путь правил не является файлом: ${this.rulesFile}`);
    }
    if (!info.isDirectory()) {
      if (this.rulesPath) throw new Error(`Путь правил не является папкой: ${this.rulesPath}`);
    }
  }

  async scanRules(current = this.rulesPath, result = { files: [], documents: [] }) {
    if (this.rulesFile) {
      return this.scanRuleFile(this.rulesFile, path.basename(this.rulesFile), result);
    }

    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(this.rulesPath, absolute).replaceAll("\\", "/");

      if (entry.isDirectory()) {
        await this.scanRules(absolute, result);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!RULE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (result.files.length >= MAX_RULE_FILES) {
        throw new Error(`Слишком много файлов правил. Лимит: ${MAX_RULE_FILES}.`);
      }

      await this.scanRuleFile(absolute, relative, result);
    }

    return result;
  }

  async scanRuleFile(absolute, relative, result) {
    const info = await stat(absolute);
    if (info.size > MAX_RULE_FILE_BYTES) {
      result.files.push({
        file: relative,
        size: info.size,
        mtimeMs: info.mtimeMs,
        skipped: "too-large",
      });
      return result;
    }

    const text = await readFile(absolute, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    result.files.push({
      file: relative,
      size: info.size,
      mtimeMs: info.mtimeMs,
      hash,
    });
    result.documents.push({
      file: relative,
      text,
      lines: text.split(/\r?\n/),
    });
    return result;
  }

  compare(beforeFiles, afterFiles) {
    const before = new Map(beforeFiles.map((file) => [file.file, file]));
    const after = new Map(afterFiles.map((file) => [file.file, file]));
    const added = [];
    const modified = [];
    const deleted = [];

    for (const [file, metadata] of after.entries()) {
      const previous = before.get(file);
      if (!previous) added.push(file);
      else if (previous.hash !== metadata.hash || previous.size !== metadata.size) modified.push(file);
    }

    for (const file of before.keys()) {
      if (!after.has(file)) deleted.push(file);
    }

    return { added, modified, deleted };
  }

  analyze(documents, changes) {
    const findings = [];
    const statements = [];

    for (const document of documents) {
      document.lines.forEach((line, index) => {
        const text = line.trim();
        if (!text) return;
        const kind = this.statementKind(text);
        if (kind) {
          statements.push({
            file: document.file,
            line: index + 1,
            text,
            kind,
            tokens: this.topicTokens(text),
          });
        }

        const loophole = this.loopholeReason(text);
        if (loophole) {
          findings.push({
            severity: "critical",
            type: "loophole",
            file: document.file,
            line: index + 1,
            message: loophole,
            text,
            suggestion: this.suggestChange("loophole", text),
          });
        }

        const weakening = this.weakeningReason(text);
        if (weakening && (changes.added.includes(document.file) || changes.modified.includes(document.file))) {
          findings.push({
            severity: "warning",
            type: "weakening",
            file: document.file,
            line: index + 1,
            message: weakening,
            text,
            suggestion: this.suggestChange("weakening", text),
          });
        }
      });
    }

    for (let leftIndex = 0; leftIndex < statements.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < statements.length; rightIndex += 1) {
        const left = statements[leftIndex];
        const right = statements[rightIndex];
        if (left.kind === right.kind) continue;
        const overlap = left.tokens.filter((token) => right.tokens.includes(token));
        if (overlap.length < 2) continue;

        findings.push({
          severity: "critical",
          type: "contradiction",
          file: left.file,
          line: left.line,
          message: `Возможное противоречие с ${right.file}:${right.line}. Общие темы: ${overlap.slice(0, 5).join(", ")}.`,
          text: left.text,
          suggestion: this.suggestChange("contradiction", left.text, right.text),
          related: {
            file: right.file,
            line: right.line,
            text: right.text,
          },
        });
      }
    }

    return findings.slice(0, 50);
  }

  suggestChange(type, text, relatedText = "") {
    if (type === "contradiction") {
      return [
        "Заменить конфликтующие записи на одну формулировку:",
        "\"При противоречии правил действует более строгий запрет. Исключения разрешены только если они явно перечислены в этом же правиле и не ослабляют требования безопасности.\"",
        `Проверить вторую запись: ${relatedText}`,
      ].join(" ");
    }

    if (type === "weakening") {
      return [
        "Заменить на:",
        "\"Исключение допускается только при явном разрешении владельца правил, с указанием области действия, срока действия и проверяемого результата. Если эти условия не указаны, действует базовый запрет.\"",
      ].join(" ");
    }

    if (/если задача требует|if the task requires/i.test(text)) {
      return [
        "Заменить на:",
        "\"Если задача требует отступления от правила, сначала описать причину, риск и точное действие, затем дождаться явного подтверждения владельца правил. Без подтверждения выполнять только часть, не нарушающую правила.\"",
      ].join(" ");
    }

    if (/ignore|bypass|override|jailbreak|игнор|обход|обойти/i.test(text)) {
      return [
        "Заменить на:",
        "\"Запрещено игнорировать, обходить, переопределять или ослаблять системные, разработческие и локальные правила. При конфликте инструкций выбрать более безопасное и более строгое правило.\"",
      ].join(" ");
    }

    return [
      "Заменить на:",
      "\"Правило обязательно к исполнению. Все исключения должны быть явно перечислены в тексте правила; неописанные исключения запрещены. При неоднозначности выбрать более строгую трактовку.\"",
    ].join(" ");
  }

  statementKind(text) {
    const lower = text.toLowerCase();
    if (/(запрещено|нельзя|не должен|никогда|never|must not|forbidden|do not|don't)/i.test(lower)) {
      return "prohibit";
    }
    if (/(обязан|должен|требуется|всегда|необходимо|must|always|required|shall)/i.test(lower)) {
      return "require";
    }
    return null;
  }

  loopholeReason(text) {
    const lower = text.toLowerCase();
    if (/(ignore|bypass|override|jailbreak|обойти|игнорируй|игнорировать|обход)/i.test(lower)) {
      return "Обнаружена формулировка, похожая на обход или игнорирование правил.";
    }
    if (/(system prompt|developer message|system instruction|системн.*инструкц|developer.*инструкц)/i.test(lower)) {
      return "Правило ссылается на системные/разработческие инструкции; проверьте, не раскрывает ли оно лишнюю поверхность атаки.";
    }
    if (/(если пользователь попросит|по просьбе пользователя|unless the user|if the user asks)/i.test(lower)) {
      return "Обнаружено исключение по просьбе пользователя; это частый источник лазеек.";
    }
    return null;
  }

  weakeningReason(text) {
    const lower = text.toLowerCase();
    if (/(кроме|исключени|можно не|необязательно|допускается|разрешено|unless|except|optional|may ignore)/i.test(lower)) {
      return "Новая или измененная строка похожа на ослабление ограничения или новое исключение.";
    }
    return null;
  }

  topicTokens(text) {
    const stopWords = new Set([
      "должен",
      "должна",
      "должно",
      "нельзя",
      "запрещено",
      "всегда",
      "никогда",
      "must",
      "always",
      "never",
      "not",
      "with",
      "from",
      "this",
      "that",
      "если",
      "когда",
      "пользователь",
    ]);

    return [...new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_-]+/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !stopWords.has(token)),
    )];
  }

  statusFromFindings(findings, changes) {
    if (findings.some((finding) => finding.severity === "critical")) return "critical";
    if (findings.length > 0) return "warning";
    if (changes.added.length || changes.modified.length || changes.deleted.length) return "changed";
    return "ok";
  }

  async loadBaseline() {
    try {
      return JSON.parse(await readFile(this.baselineFile, "utf8"));
    } catch {
      return { files: [] };
    }
  }

  async loadReviewPackage() {
    try {
      const legacy = JSON.parse(await readFile(this.reviewQueueFile, "utf8"));
      if (legacy.available && legacy.text) {
        return this.saveReviewPackage(legacy, { includeText: true });
      }
      return legacy;
    } catch {
      return this.emptyReviewPackage();
    }
  }

  async saveReviewPackage(reviewPackage, { includeText = false } = {}) {
    const existing = await this.findPendingReviewByHash(this.reviewPackageHash(reviewPackage));
    if (existing?.available) {
      if (!includeText) return existing;
      const text = await readFile(existing.diffFile, "utf8");
      return { ...existing, text };
    }

    const id = this.reviewPackageId(reviewPackage);
    const diffFile = path.join(this.reviewDir, `${id}.diff`);
    const metadataFile = path.join(this.reviewDir, `${id}.json`);
    const payload = {
      available: true,
      id,
      mode: reviewPackage.mode,
      status: "pending",
      createdAt: new Date().toISOString(),
      role: this.rulesRole,
      rulesPath: this.rulesPath,
      rulesFile: this.rulesFile,
      reviewDir: this.reviewDir,
      diffFile,
      files: this.reviewFileMetadata(reviewPackage.files),
      note: reviewPackage.note,
    };
    await mkdir(this.reviewDir, { recursive: true });
    await writeFile(diffFile, reviewPackage.text, "utf8");
    await writeFile(metadataFile, JSON.stringify(payload, null, 2), "utf8");
    await rm(this.reviewQueueFile, { force: true });
    return includeText ? { ...payload, text: reviewPackage.text } : payload;
  }

  async pendingReview({ complete = false, includeText = false, id = null } = {}) {
    const reviewPackage = id
      ? await this.loadReviewPackageById(id, { includeText })
      : await this.firstReviewPackage({ includeText });
    if (complete && reviewPackage.available) {
      await this.completeReview(reviewPackage.id);
      return {
        ...reviewPackage,
        status: "completed",
        completedAt: new Date().toISOString(),
      };
    }
    return reviewPackage;
  }

  async completeReview(id = null, { reviewMessage = null } = {}) {
    const completedAt = new Date().toISOString();
    if (id) {
      const reviewPackage = await this.loadReviewPackageById(id).catch(() => null);
      if (reviewPackage?.available) {
        const historyEntry = {
          ...reviewPackage,
          status: "completed",
          completedAt,
          reviewMessage: this.cleanReviewMessage(reviewMessage),
        };
        await this.saveReviewHistory(historyEntry);
        for (const notification of this.reviewNotifications(historyEntry)) {
          await this.saveRuleNotification(notification);
        }
      }
      await rm(path.join(this.reviewDir, `${id}.diff`), { force: true });
      await rm(path.join(this.reviewDir, `${id}.json`), { force: true });
    } else {
      const reviewPackage = await this.firstReviewPackage();
      if (reviewPackage.available) await this.completeReview(reviewPackage.id, { reviewMessage });
      await rm(this.reviewQueueFile, { force: true });
    }
    return this.emptyReviewPackage({
      status: "completed",
      completedAt,
    });
  }

  async saveReviewHistory(entry) {
    const history = await this.listReviewHistory({ limit: 50 });
    const next = [
      {
        id: entry.id,
        status: entry.status,
        role: entry.role,
        rulesFile: entry.rulesFile,
        rulesPath: entry.rulesPath,
        files: this.reviewFileMetadata(entry.files ?? []),
        completedAt: entry.completedAt,
        reviewMessage: entry.reviewMessage || "Разобрано без текста AI-замечаний.",
      },
      ...history.filter((item) => item.id !== entry.id),
    ].slice(0, 20);
    await mkdir(path.dirname(this.reviewHistoryFile), { recursive: true });
    await writeFile(this.reviewHistoryFile, JSON.stringify(next, null, 2), "utf8");
  }

  async syncRuleNotifications({ findings = [], reviewHistory = [] } = {}) {
    const existing = await this.listRuleNotifications();
    const existingSourceIds = new Set(existing.map((item) => item.sourceId).filter(Boolean));
    const completedSourceIds = await this.listCompletedNotificationSourceIds();

    for (const finding of findings) {
      const notification = this.findingNotification(finding);
      if (!existingSourceIds.has(notification.sourceId) && !completedSourceIds.has(notification.sourceId)) {
        await this.saveRuleNotification(notification);
        existingSourceIds.add(notification.sourceId);
      }
    }

    for (const entry of reviewHistory) {
      if (!entry.reviewMessage || entry.reviewMessage === "Разобрано без текста AI-замечаний.") continue;
      for (const notification of this.reviewNotifications(entry)) {
        if (!existingSourceIds.has(notification.sourceId) && !completedSourceIds.has(notification.sourceId)) {
          await this.saveRuleNotification(notification);
          existingSourceIds.add(notification.sourceId);
        }
      }
    }

    return this.listRuleNotifications();
  }

  findingNotification(finding) {
    const place = [finding.file, finding.line].filter(Boolean).join(":");
    const sourceId = this.notificationSourceId([
      "finding",
      finding.severity,
      finding.type,
      finding.file,
      finding.line,
      finding.text,
    ]);
    return {
      sourceId,
      source: "rules-finding",
      severity: finding.severity || "info",
      title: `${finding.severity || "info"} / ${finding.type || "rule"} / ${place}`,
      detail: finding.message || finding.text || "",
      quote: finding.related
        ? `${finding.text}\n→ ${finding.related.file}:${finding.related.line}: ${finding.related.text}`
        : finding.text || "",
      suggestion: finding.suggestion || "Предложение: уточнить формулировку и убрать возможную лазейку.",
    };
  }

  reviewNotifications(entry) {
    const files = this.reviewFileMetadata(entry.files ?? []).map((file) => file.file).filter(Boolean).join(", ");
    const message = this.cleanReviewMessage(entry.reviewMessage);
    if (!message || /^DONT_NOTIFY\b/i.test(message)) return [];

    const parsed = this.parseReviewMessage(message, entry);
    if (parsed.length) return parsed;

    return [{
      sourceId: this.notificationSourceId(["ai-review", entry.id, message]),
      source: "ai-review",
      severity: "info",
      title: `info / ai-review / ${files || entry.id}`,
      detail: [entry.completedAt, files].filter(Boolean).join(" / "),
      quote: message,
      suggestion: "",
    }];
  }

  parseReviewMessage(message, entry) {
    const lines = message.split("\n").map((line) => line.trim()).filter(Boolean);
    const chunks = [];
    let current = null;

    for (const line of lines) {
      if (this.isReviewItemStart(line)) {
        if (current) chunks.push(current);
        current = [line];
      } else if (/^([-*]|\d+[.)])\s+/.test(line)) {
        if (current) chunks.push(current);
        current = null;
      } else if (current) {
        current.push(line);
      }
    }
    if (current) chunks.push(current);

    return chunks
      .map((chunk, index) => this.reviewChunkNotification(chunk, entry, index))
      .filter(Boolean);
  }

  isReviewItemStart(line) {
    if (!/^([-*]|\d+[.)])\s+/.test(line)) return false;
    const body = line.replace(/^([-*]|\d+[.)])\s+/, "").trim();
    if (/^(статус риска|подозрительные изменения|четкие|чёткие|решение)\b/i.test(body)) return false;
    return /(\.(md|txt|json|ya?ml|rules)(:\d+)?\b|warning|error|critical|info|критич|ошибк|подозр|риск|ослаб|лазейк|исключен)/i.test(body);
  }

  reviewChunkNotification(chunk, entry, index) {
    const text = chunk.join("\n").replace(/^([-*]|\d+[.)])\s+/, "").trim();
    if (!text || /^DONT_NOTIFY\b/i.test(text)) return null;

    const severity = this.reviewSeverity(text);
    const place = this.reviewPlace(text, entry) || `diff:${index + 1}`;
    const quote = this.reviewQuote(text);
    const suggestion = this.reviewSuggestion(text);
    const detail = this.reviewDetail(text);

    return {
      sourceId: this.notificationSourceId(["ai-review-item", entry.id, index, severity, place, quote || text]),
      source: "ai-review",
      severity,
      title: `${severity} / ai-review / ${place}`,
      detail,
      quote: quote || text,
      suggestion,
    };
  }

  reviewSeverity(text) {
    const lower = text.toLowerCase();
    if (/(critical|критич|опасн|запрещ|уязвим|ошибк|error)/i.test(lower)) return "error";
    if (/(warning|подозр|риск|ослаб|лазейк|исключен)/i.test(lower)) return "warning";
    return "info";
  }

  reviewPlace(text, entry) {
    const direct = text.match(/([A-Za-z0-9_. -]+\.(?:md|txt|json|ya?ml|rules))(?::(\d+))?/i);
    if (direct) return [direct[1].trim(), direct[2]].filter(Boolean).join(":");
    const files = this.reviewFileMetadata(entry.files ?? []).map((file) => file.file).filter(Boolean);
    return files[0] ?? "";
  }

  reviewQuote(text) {
    const diffLine = text.split("\n").find((line) => /^[-+]\s+/.test(line));
    if (diffLine) return diffLine.trim();
    const quoted = text.match(/["'«`](.+?)["'»`]/s);
    if (quoted) return quoted[1].trim();
    return text.split("\n")[0]?.trim() ?? "";
  }

  reviewSuggestion(text) {
    const line = text.split("\n").find((item) => /(?:заменить|предложение|правка|формулировка|replace|suggestion)\s*:?/i.test(item));
    if (!line) return "";
    return line.replace(/^.*?(?:заменить|предложение|правка|формулировка|replace|suggestion)\s*:?/i, "").trim();
  }

  reviewDetail(text) {
    const firstLine = text.split("\n")[0] ?? "";
    const cleaned = firstLine
      .replace(/\s*(?:заменить|предложение|правка|формулировка|replace|suggestion)\s*:?.*$/i, "")
      .trim();
    return cleaned || "AI-анализ diff правил.";
  }

  reviewNotification(entry) {
    const files = this.reviewFileMetadata(entry.files ?? []).map((file) => file.file).filter(Boolean).join(", ");
    return {
      sourceId: this.notificationSourceId(["ai-review", entry.id]),
      source: "ai-review",
      severity: "info",
      title: "AI-разбор правил",
      detail: [entry.completedAt, files].filter(Boolean).join(" / "),
      quote: entry.reviewMessage || "Разобрано без текста AI-замечаний.",
      suggestion: "",
    };
  }

  async saveRuleNotification(notification) {
    const createdAt = new Date().toISOString();
    const id = this.notificationId(notification.sourceId, createdAt, notification.severity);
    const payload = {
      id,
      createdAt,
      ...notification,
    };
    await mkdir(this.notificationDir, { recursive: true });
    await writeFile(path.join(this.notificationDir, `${id}.json`), JSON.stringify(payload, null, 2), "utf8");
    return payload;
  }

  async listRuleNotifications() {
    let entries;
    try {
      entries = await readdir(this.notificationDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const notifications = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "completed.json") continue;
      try {
        const data = JSON.parse(await readFile(path.join(this.notificationDir, entry.name), "utf8"));
        notifications.push(this.sanitizeRuleNotification(data));
      } catch {
        continue;
      }
    }
    notifications.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    return notifications;
  }

  async completeRuleNotification(id) {
    if (!/^(warning|error|critical|info)_\d{8}-\d{6}_[A-Za-z0-9_-]+$/.test(id)) {
      throw new Error("Invalid notification id.");
    }
    const notification = await this.loadRuleNotification(id).catch(() => null);
    if (notification?.sourceId) {
      await this.saveCompletedNotificationSourceId(notification.sourceId);
    }
    await rm(path.join(this.notificationDir, `${id}.json`), { force: true });
    return { ok: true, id, notifications: await this.listRuleNotifications() };
  }

  async loadRuleNotification(id) {
    return this.sanitizeRuleNotification(JSON.parse(await readFile(path.join(this.notificationDir, `${id}.json`), "utf8")));
  }

  async listCompletedNotificationSourceIds() {
    try {
      const data = JSON.parse(await readFile(this.completedNotificationsFile, "utf8"));
      if (!Array.isArray(data)) return new Set();
      return new Set(data.map(String));
    } catch {
      return new Set();
    }
  }

  async saveCompletedNotificationSourceId(sourceId) {
    const completed = await this.listCompletedNotificationSourceIds();
    completed.add(String(sourceId));
    await mkdir(this.notificationDir, { recursive: true });
    await writeFile(this.completedNotificationsFile, JSON.stringify([...completed].slice(-500), null, 2), "utf8");
  }

  sanitizeRuleNotification(data) {
    return {
      id: String(data.id ?? ""),
      sourceId: String(data.sourceId ?? ""),
      source: String(data.source ?? "rules"),
      severity: String(data.severity ?? "info"),
      title: String(data.title ?? "Замечание"),
      detail: String(data.detail ?? ""),
      quote: String(data.quote ?? ""),
      suggestion: String(data.suggestion ?? ""),
      createdAt: String(data.createdAt ?? ""),
    };
  }

  notificationSourceId(parts) {
    return createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
  }

  notificationId(sourceId, createdAt, severity = "warning") {
    const stamp = createdAt.replace(/\D/g, "").slice(0, 14);
    const prefix = this.notificationPrefix(severity);
    return `${prefix}_${stamp.slice(0, 8)}-${stamp.slice(8, 14)}_${sourceId}`;
  }

  notificationPrefix(severity) {
    if (severity === "critical") return "critical";
    if (severity === "error") return "error";
    if (severity === "info") return "info";
    return "warning";
  }

  async listReviewHistory({ limit = 5 } = {}) {
    try {
      const history = JSON.parse(await readFile(this.reviewHistoryFile, "utf8"));
      if (!Array.isArray(history)) return [];
      return history.slice(0, limit).map((entry) => ({
        id: String(entry.id ?? ""),
        status: String(entry.status ?? "completed"),
        role: String(entry.role ?? ""),
        rulesFile: entry.rulesFile ? String(entry.rulesFile) : null,
        rulesPath: entry.rulesPath ? String(entry.rulesPath) : null,
        files: this.reviewFileMetadata(entry.files ?? []),
        completedAt: String(entry.completedAt ?? ""),
        reviewMessage: this.cleanReviewMessage(entry.reviewMessage),
      }));
    } catch {
      return [];
    }
  }

  cleanReviewMessage(message) {
    if (typeof message !== "string") return "";
    return message.trim().replace(/\r\n/g, "\n").slice(0, 8000);
  }

  async firstReviewPackage({ includeText = false } = {}) {
    const packages = await this.listReviewPackages();
    if (packages.length === 0) return this.loadReviewPackage();
    return this.loadReviewPackageById(packages[0].id, { includeText });
  }

  async listReviewPackages() {
    let entries;
    try {
      entries = await readdir(this.reviewDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const packages = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const metadata = JSON.parse(await readFile(path.join(this.reviewDir, entry.name), "utf8"));
        packages.push(this.sanitizeReviewMetadata(metadata));
      } catch {
        continue;
      }
    }
    packages.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    return packages;
  }

  async loadReviewPackageById(id, { includeText = false } = {}) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid review package id.");
    const metadataFile = path.join(this.reviewDir, `${id}.json`);
    const metadata = this.sanitizeReviewMetadata(JSON.parse(await readFile(metadataFile, "utf8")));
    if (!includeText) return metadata;
    const text = await readFile(path.join(this.reviewDir, `${id}.diff`), "utf8");
    return { ...metadata, text };
  }

  reviewPackageId(reviewPackage) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    return `${stamp}-${this.reviewPackageHash(reviewPackage)}`;
  }

  reviewPackageHash(reviewPackage) {
    return createHash("sha256").update(reviewPackage.text).digest("hex").slice(0, 12);
  }

  async findPendingReviewByHash(hash) {
    if (!hash) return null;
    const packages = await this.listReviewPackages();
    return packages.find((item) => item.id?.endsWith(`-${hash}`)) ?? null;
  }

  reviewFileMetadata(files = []) {
    return files.map((file) => ({
      file: file.file,
      type: file.type,
      truncated: Boolean(file.truncated),
    }));
  }

  sanitizeReviewMetadata(metadata) {
    return {
      ...metadata,
      files: this.reviewFileMetadata(metadata.files ?? []),
    };
  }

  emptyReviewPackage(extra = {}) {
    return {
      available: false,
      mode: "local-diff",
      status: "empty",
      reviewDir: this.reviewDir,
      files: [],
      text: "",
      note: "Нет ожидающих diff для AI-анализа.",
      ...extra,
    };
  }

  async saveBaseline(scan) {
    await mkdir(path.dirname(this.baselineFile), { recursive: true });
    await writeFile(
      this.baselineFile,
      JSON.stringify(
        {
      updatedAt: new Date().toISOString(),
      rulesPath: this.rulesPath,
      rulesFile: this.rulesFile,
      role: this.rulesRole,
      files: scan.files,
      documents: scan.documents.map((document) => ({
        file: document.file,
        text: document.text,
        lines: document.lines,
      })),
        },
        null,
        2,
      ),
    );
  }

  networkAccessNote() {
    const source = this.rulesFile ?? this.rulesPath;
    if (!source?.startsWith("\\\\")) return null;
    return "UNC-путь читается учетной записью службы. Если служба работает как LocalSystem, сетевой ресурс должен разрешать доступ этой учетной записи или машине.";
  }
}
