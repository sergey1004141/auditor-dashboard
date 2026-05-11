import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const { access } = fs;

export class GitService {
  async summarize(projectPath) {
    if (!(await this.exists(path.join(projectPath, ".git")))) {
      return { available: false, reason: "Project is not a git repository." };
    }

    const branch = await this.run("git", ["branch", "--show-current"], projectPath);
    const status = await this.run("git", ["status", "--short"], projectPath);
    const diffStat = await this.run("git", ["diff", "--stat"], projectPath);

    if (!branch.ok && !status.ok) {
      return {
        available: false,
        reason: "Git command is unavailable or failed.",
        error: branch.error || status.error,
      };
    }

    return {
      available: true,
      branch: branch.stdout || "(detached or unknown)",
      status: status.stdout || "(clean)",
      diffStat: diffStat.stdout || "",
    };
  }

  run(command, args, cwd) {
    return new Promise((resolve) => {
      execFile(command, args, { cwd, windowsHide: true, timeout: 8000 }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: error?.message ?? null,
        });
      });
    });
  }

  async exists(targetPath) {
    try {
      await access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
