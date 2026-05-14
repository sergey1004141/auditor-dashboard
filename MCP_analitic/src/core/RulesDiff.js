const MAX_DIFF_LINES_PER_FILE = 160;
const CONTEXT_LINES = 2;
const MAX_LCS_LINES = 2000;

export class RulesDiff {
  build(previousDocuments = [], currentDocuments = [], changes = { added: [], modified: [], deleted: [] }) {
    const previous = new Map(previousDocuments.map((document) => [document.file, document]));
    const current = new Map(currentDocuments.map((document) => [document.file, document]));
    const files = [];

    for (const file of changes.added ?? []) {
      const document = current.get(file);
      if (document) files.push(this.addedFile(document));
    }

    for (const file of changes.modified ?? []) {
      const before = previous.get(file);
      const after = current.get(file);
      if (before && after) files.push(this.modifiedFile(before, after));
    }

    for (const file of changes.deleted ?? []) {
      const document = previous.get(file);
      if (document) files.push(this.deletedFile(document));
    }

    return {
      available: files.length > 0,
      mode: "local-diff",
      files,
      text: files.map((file) => file.diff).filter(Boolean).join("\n"),
      note: "Для глубокого AI-анализа передается только diff изменений правил, а не полный файл.",
    };
  }

  addedFile(document) {
    const lines = document.lines.slice(0, MAX_DIFF_LINES_PER_FILE);
    return {
      file: document.file,
      type: "added",
      truncated: document.lines.length > lines.length,
      diff: [
        `--- /dev/null`,
        `+++ ${document.file}`,
        ...lines.map((line) => `+${line}`),
      ].join("\n"),
    };
  }

  deletedFile(document) {
    const lines = document.lines.slice(0, MAX_DIFF_LINES_PER_FILE);
    return {
      file: document.file,
      type: "deleted",
      truncated: document.lines.length > lines.length,
      diff: [
        `--- ${document.file}`,
        `+++ /dev/null`,
        ...lines.map((line) => `-${line}`),
      ].join("\n"),
    };
  }

  modifiedFile(before, after) {
    const beforeLines = before.lines;
    const afterLines = after.lines;
    const opcodes = beforeLines.length > MAX_LCS_LINES || afterLines.length > MAX_LCS_LINES
      ? this.positionalDiffLines(beforeLines, afterLines)
      : this.diffLines(beforeLines, afterLines);
    const changedIndexes = new Set();

    for (const opcode of opcodes) {
      if (opcode.type === "equal") continue;
      for (let index = Math.max(0, opcode.afterStart - CONTEXT_LINES); index < Math.min(afterLines.length, opcode.afterEnd + CONTEXT_LINES); index += 1) {
        changedIndexes.add(index);
      }
    }

    const ranges = this.mergeIndexes([...changedIndexes].sort((left, right) => left - right));
    const diffLines = [`--- ${before.file}`, `+++ ${after.file}`];
    let emitted = 0;

    for (const range of ranges) {
      if (emitted >= MAX_DIFF_LINES_PER_FILE) break;
      diffLines.push(`@@ ${range.start + 1},${range.end - range.start + 1} @@`);
      for (const opcode of opcodes) {
        if (emitted >= MAX_DIFF_LINES_PER_FILE) break;
        if (opcode.afterEnd < range.start || opcode.afterStart > range.end) continue;
        emitted += this.emitOpcode(diffLines, opcode, beforeLines, afterLines, range);
      }
    }

    return {
      file: after.file,
      type: "modified",
      truncated: emitted >= MAX_DIFF_LINES_PER_FILE,
      diff: diffLines.join("\n"),
    };
  }

  emitOpcode(diffLines, opcode, beforeLines, afterLines, range) {
    let emitted = 0;
    if (opcode.type === "equal") {
      for (let index = Math.max(opcode.afterStart, range.start); index < Math.min(opcode.afterEnd, range.end + 1); index += 1) {
        diffLines.push(` ${afterLines[index]}`);
        emitted += 1;
      }
      return emitted;
    }

    for (let index = opcode.beforeStart; index < opcode.beforeEnd; index += 1) {
      diffLines.push(`-${beforeLines[index]}`);
      emitted += 1;
    }
    for (let index = opcode.afterStart; index < opcode.afterEnd; index += 1) {
      diffLines.push(`+${afterLines[index]}`);
      emitted += 1;
    }
    return emitted;
  }

  mergeIndexes(indexes) {
    const ranges = [];
    for (const index of indexes) {
      const last = ranges.at(-1);
      if (last && index <= last.end + 1) {
        last.end = index;
      } else {
        ranges.push({ start: index, end: index });
      }
    }
    return ranges;
  }

  positionalDiffLines(before, after) {
    const ops = [];
    const maxLength = Math.max(before.length, after.length);
    let index = 0;
    while (index < maxLength) {
      const same = before[index] === after[index];
      const start = index;
      while (index < maxLength && (before[index] === after[index]) === same) {
        index += 1;
      }
      ops.push({
        type: same ? "equal" : "change",
        beforeStart: start,
        beforeEnd: Math.min(index, before.length),
        afterStart: start,
        afterEnd: Math.min(index, after.length),
      });
    }
    return ops;
  }

  diffLines(before, after) {
    const table = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0));
    for (let left = before.length - 1; left >= 0; left -= 1) {
      for (let right = after.length - 1; right >= 0; right -= 1) {
        table[left][right] = before[left] === after[right]
          ? table[left + 1][right + 1] + 1
          : Math.max(table[left + 1][right], table[left][right + 1]);
      }
    }

    const ops = [];
    let left = 0;
    let right = 0;
    while (left < before.length || right < after.length) {
      if (left < before.length && right < after.length && before[left] === after[right]) {
        const startLeft = left;
        const startRight = right;
        while (left < before.length && right < after.length && before[left] === after[right]) {
          left += 1;
          right += 1;
        }
        ops.push({ type: "equal", beforeStart: startLeft, beforeEnd: left, afterStart: startRight, afterEnd: right });
      } else {
        const startLeft = left;
        const startRight = right;
        while (left < before.length || right < after.length) {
          if (left < before.length && right < after.length && before[left] === after[right]) break;
          if (right >= after.length || (left < before.length && table[left + 1][right] >= table[left][right + 1])) {
            left += 1;
          } else {
            right += 1;
          }
        }
        ops.push({ type: "change", beforeStart: startLeft, beforeEnd: left, afterStart: startRight, afterEnd: right });
      }
    }
    return ops;
  }
}
