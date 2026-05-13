import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RULES_BASELINE_FILE } from "../config.js";
import { ConfigStore } from "./ConfigStore.js";

const { mkdir, readFile, readdir, stat, writeFile } = fs;

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
  } = {}) {
    this.rulesPath = initialRulesPath ? path.resolve(initialRulesPath) : null;
    this.rulesFile = initialRulesFile ? path.resolve(initialRulesFile) : null;
    this.rulesRole = initialRole;
    this.rulesConfiguredAt = null;
    this.configStore = configStore;
    this.baselineFile = baselineFile;
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
    await this.saveBaseline(scan.files);
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

  async status({ updateBaseline = true } = {}) {
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

      if (updateBaseline) {
        await this.saveBaseline(scan.files);
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
        accessNote: this.networkAccessNote(),
      };
    } catch (error) {
      const source = this.rulesFile ?? this.rulesPath;
      return {
        configured: true,
        status: "error",
        rulesPath: this.rulesPath,
        rulesFile: this.rulesFile,
        role: this.rulesRole,
        sampledAt: new Date().toISOString(),
        error: error.message,
        changes: { added: [], modified: [], deleted: [] },
        findings: [
          {
            severity: "critical",
            type: "access",
            file: source,
            message: `Файл правил недоступен: ${error.message}`,
            text: source,
            suggestion: "Проверить сетевой путь, доступ учетной записи службы и доступность машины с файлом правил.",
          },
        ],
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

  async saveBaseline(files) {
    await mkdir(path.dirname(this.baselineFile), { recursive: true });
    await writeFile(
      this.baselineFile,
      JSON.stringify(
        {
      updatedAt: new Date().toISOString(),
      rulesPath: this.rulesPath,
      rulesFile: this.rulesFile,
      role: this.rulesRole,
      files,
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
