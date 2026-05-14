import { promises as fs } from "node:fs";
import path from "node:path";
import { TaskHistoryParser } from "./TaskHistoryParser.js";

const { readdir, readFile, stat } = fs;
const DEFAULT_TASKS_ROOT = "\\\\HOME_SERGEY\\codex$";

export class TaskHistoryService {
  constructor({
    tasksRoot = process.env.AUDITOR_TASKS_ROOT ?? DEFAULT_TASKS_ROOT,
    parser = new TaskHistoryParser(),
  } = {}) {
    this.tasksRoot = tasksRoot;
    this.taskMemoryRoot = path.win32.join(this.tasksRoot, "task-memory");
    this.parser = parser;
  }

  async status() {
    const files = await this.workedTaskFiles();
    const rows = [];

    for (const file of files) {
      const dev = this.devFromFile(file.name);
      const raw = await readFile(file.absolute, "utf8");
      for (const task of this.parser.parseWorkedTasks(raw)) {
        const history = await this.historyInfo(task.name);
        rows.push({
          task: task.name,
          status: task.status,
          modified: task.modified,
          developer: dev,
          sourceFile: file.absolute,
          historyPath: history.path,
          historyExists: history.exists,
          historyModified: history.modified,
          historyUrl: history.exists ? `/api/tasks/history/${encodeURIComponent(task.name)}.md` : null,
        });
      }
    }

    const uniqueRows = this.parser.sortRowsByModified(this.parser.latestRowsByTask(rows));

    return {
      available: true,
      sampledAt: new Date().toISOString(),
      tasksRoot: this.tasksRoot,
      taskMemoryRoot: this.taskMemoryRoot,
      files: files.map((file) => ({
        name: file.name,
        path: file.absolute,
        modified: file.modified,
      })),
      rows: uniqueRows,
    };
  }

  async readHistory(taskName) {
    if (!/^[A-Za-z0-9_-]+$/.test(taskName)) {
      throw new Error("Invalid task name.");
    }

    const historyPath = path.win32.join(this.taskMemoryRoot, `${taskName}.md`);
    const content = await readFile(historyPath, "utf8");
    return {
      task: taskName,
      path: historyPath,
      content,
    };
  }

  async workedTaskFiles() {
    const entries = await readdir(this.tasksRoot, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^Dev\d+_WORKED_TASKS\.md$/i.test(entry.name)) continue;
      const absolute = path.win32.join(this.tasksRoot, entry.name);
      const info = await stat(absolute);
      files.push({
        name: entry.name,
        absolute,
        modified: this.formatMsk(info.mtime),
      });
    }
    files.sort((left, right) => left.name.localeCompare(right.name, "ru"));
    return files;
  }

  devFromFile(fileName) {
    const match = fileName.match(/^(Dev\d+)_WORKED_TASKS\.md$/i);
    return match ? match[1] : fileName;
  }

  async historyInfo(taskName) {
    const historyPath = path.win32.join(this.taskMemoryRoot, `${taskName}.md`);
    try {
      const info = await stat(historyPath);
      return {
        path: historyPath,
        exists: info.isFile(),
        modified: this.formatMsk(info.mtime),
      };
    } catch {
      return {
        path: historyPath,
        exists: false,
        modified: null,
      };
    }
  }

  formatMsk(date) {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
}
