export class TaskHistoryParser {
  parseWorkedTasks(content) {
    const rows = [];
    for (const line of content.split(/\r?\n/)) {
      const task = this.parseWorkedTaskLine(line);
      if (task) rows.push(task);
    }
    return rows;
  }

  parseWorkedTaskLine(line) {
    const text = line.trim();
    if (!text) return null;

    const match = text.match(/^([A-Za-z]+-\d+)\s+-\s+(.+?)(?:\s+\[([^\]]+)\])?$/);
    if (!match) return null;

    return {
      name: match[1],
      status: match[2].trim(),
      modified: match[3]?.replace(/\s+MSK$/i, "") ?? null,
    };
  }

  latestRowsByTask(rows) {
    const latestByTask = new Map();
    for (const row of rows) {
      const current = latestByTask.get(row.task);
      if (!current || this.sortTime(row.modified) >= this.sortTime(current.modified)) {
        latestByTask.set(row.task, row);
      }
    }
    return [...latestByTask.values()];
  }

  sortRowsByModified(rows) {
    return [...rows].sort((left, right) => this.compareRowsByModified(left, right));
  }

  compareRowsByModified(left, right) {
    const timeDiff = this.sortTime(right.modified) - this.sortTime(left.modified);
    if (timeDiff !== 0) return timeDiff;
    return left.task.localeCompare(right.task, "ru", { numeric: true });
  }

  sortTime(value) {
    if (!value) return 0;
    const parsed = Date.parse(value.replace(" ", "T"));
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
