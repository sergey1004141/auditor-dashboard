import { promises as fs, watch as fsWatch } from "node:fs";
import path from "node:path";
import { MAX_RECENT_EVENTS } from "../config.js";
import { ConfigStore } from "./ConfigStore.js";
import { FileSnapshot } from "./FileSnapshot.js";
import { GitService } from "./GitService.js";
import { PathRules } from "./PathRules.js";

const { readFile, stat } = fs;

export class ProjectMonitor {
  constructor({
    initialProjectPath = process.env.PROJECT_WATCH_PATH,
    configStore = new ConfigStore({
      disabled: process.env.PROJECT_WATCH_DISABLE_CONFIG === "1",
    }),
    pathRules = new PathRules(),
    snapshot = null,
    gitService = new GitService(),
    maxRecentEvents = MAX_RECENT_EVENTS,
  } = {}) {
    this.projectPath = initialProjectPath ? path.resolve(initialProjectPath) : null;
    this.lastConfiguredAt = null;
    this.baseline = new Map();
    this.recentEvents = [];
    this.watcher = null;
    this.watcherError = null;
    this.lastSnapshotAt = null;
    this.configStore = configStore;
    this.pathRules = pathRules;
    this.snapshot = snapshot ?? new FileSnapshot(pathRules);
    this.gitService = gitService;
    this.maxRecentEvents = maxRecentEvents;
  }

  async initialize() {
    await this.loadConfig();
    if (!this.projectPath) return;

    try {
      await this.refreshSnapshot();
      await this.startWatcher();
    } catch (error) {
      this.watcherError = error.message;
    }
  }

  async configure(projectPath) {
    if (!projectPath || typeof projectPath !== "string") {
      throw new Error("configure_project requires projectPath.");
    }

    this.projectPath = path.resolve(projectPath);
    this.lastConfiguredAt = new Date().toISOString();
    await this.ensureProjectPath();
    await this.refreshSnapshot();
    await this.startWatcher();
    await this.configStore.save({
      projectPath: this.projectPath,
      lastConfiguredAt: this.lastConfiguredAt,
    });

    return {
      ok: true,
      projectPath: this.projectPath,
      trackedFiles: this.baseline.size,
      watcher: this.watcherStatus(),
      watcherError: this.watcherError,
    };
  }

  async status({ includeGit = true, refreshSnapshot = true } = {}) {
    await this.ensureProjectPath();
    if (!this.watcher && !this.watcherError) await this.startWatcher();

    const changes = refreshSnapshot ? await this.refreshSnapshot() : null;
    const git = includeGit ? await this.gitService.summarize(this.projectPath) : null;

    return {
      projectPath: this.projectPath,
      watcher: this.watcherStatus(),
      watcherError: this.watcherError,
      trackedFiles: this.baseline.size,
      lastSnapshotAt: this.lastSnapshotAt,
      snapshotChanges: changes,
      recentEvents: this.recentEvents.slice(0, 30),
      git,
    };
  }

  async recentChanges(limit = 30) {
    await this.ensureProjectPath();
    const boundedLimit = Math.min(Math.max(Number(limit), 1), 100);
    return {
      projectPath: this.projectPath,
      events: this.recentEvents.slice(0, boundedLimit),
    };
  }

  async readChangedFile(relativePath, maxBytes = 50000) {
    if (!relativePath || typeof relativePath !== "string") {
      throw new Error("read_changed_file requires relativePath.");
    }

    await this.ensureProjectPath();
    const boundedMaxBytes = Math.min(Math.max(Number(maxBytes), 1), 200000);
    const absolute = this.pathRules.resolveInside(this.projectPath, relativePath);
    const info = await stat(absolute);

    if (!info.isFile()) throw new Error("Path is not a file.");
    if (info.size > boundedMaxBytes) {
      throw new Error(`File is ${info.size} bytes, larger than maxBytes=${boundedMaxBytes}.`);
    }

    return {
      relativePath: this.pathRules.normalizeRelative(relativePath),
      contents: await readFile(absolute, "utf8"),
    };
  }

  async resetBaseline() {
    await this.ensureProjectPath();
    this.baseline = await this.snapshot.scan(this.projectPath);
    this.lastSnapshotAt = new Date().toISOString();
    this.recentEvents = [];
    return {
      ok: true,
      projectPath: this.projectPath,
      trackedFiles: this.baseline.size,
      lastSnapshotAt: this.lastSnapshotAt,
    };
  }

  async refreshSnapshot() {
    await this.ensureProjectPath();
    const next = await this.snapshot.scan(this.projectPath);
    const changes = this.snapshot.compare(this.baseline, next);
    this.baseline = next;
    this.lastSnapshotAt = new Date().toISOString();
    return changes;
  }

  async ensureProjectPath() {
    await this.loadConfig();
    if (!this.projectPath) {
      throw new Error("No project is configured. Call configure_project first or set PROJECT_WATCH_PATH.");
    }

    const info = await stat(this.projectPath);
    if (!info.isDirectory()) {
      throw new Error(`Configured path is not a directory: ${this.projectPath}`);
    }
  }

  async loadConfig() {
    if (this.projectPath) return;
    const config = await this.configStore.load();
    if (config.projectPath) {
      this.projectPath = config.projectPath;
      this.lastConfiguredAt = config.lastConfiguredAt ?? null;
    }
  }

  async startWatcher() {
    this.stopWatcher();
    this.watcherError = null;
    await this.ensureProjectPath();

    try {
      this.watcher = fsWatch(
        this.projectPath,
        { recursive: true },
        (eventType, filename) => {
          if (!filename) return;
          const relative = this.pathRules.normalizeRelative(filename.toString());
          if (this.pathRules.isIgnored(relative)) return;
          this.pushEvent({ eventType, file: relative });
        },
      );
      this.watcher.on("error", (error) => {
        this.watcherError = error.message;
        this.pushEvent({ eventType: "watcher_error", file: "", message: error.message });
      });
    } catch (error) {
      this.watcherError = error.message;
    }
  }

  stopWatcher() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  watcherStatus() {
    if (this.watcherError) return "snapshot-only";
    return this.watcher ? "active" : "inactive";
  }

  pushEvent(event) {
    this.recentEvents.unshift({
      ...event,
      at: new Date().toISOString(),
    });
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.length = this.maxRecentEvents;
    }
  }
}
