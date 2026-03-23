import * as fs from "node:fs";
import * as path from "node:path";

import {
  getOrchestratorBaseDir,
  getOrchestratorRoot,
  getOrchestratorStateDir,
} from "./orchestrator-paths.js";
import type { ListOptions } from "./cli-args.js";

interface TaskListEntry {
  task: string;
  rootDir: string;
  stateDir: string;
  loopStatus?: string;
  title?: string;
}

export async function runList(opts: ListOptions): Promise<void> {
  const baseDir = getOrchestratorBaseDir();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch (err) {
    const anyErr = err as NodeJS.ErrnoException;
    if (anyErr && anyErr.code === "ENOENT") {
      console.error(
        `[opencode-orchestrator] no orchestrator tasks found; base directory does not exist: ${baseDir}`,
      );
      return;
    }
    console.error(
      "[opencode-orchestrator] failed to read orchestrator base directory:",
      anyErr && anyErr.message ? anyErr.message : String(err),
    );
    process.exit(1);
  }

  const tasks: TaskListEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const task = entry.name;
    const rootDir = getOrchestratorRoot(task);
    const stateDir = getOrchestratorStateDir(task);

    if (!fs.existsSync(stateDir) || !fs.statSync(stateDir).isDirectory()) {
      continue;
    }

    const info: TaskListEntry = { task, rootDir, stateDir };

    const policyPath = path.join(stateDir, "command-policy.json");
    if (fs.existsSync(policyPath)) {
      try {
        const raw = fs.readFileSync(policyPath, "utf8");
        const json = JSON.parse(raw) as {
          summary?: { loop_status?: string };
        };
        if (
          json &&
          json.summary &&
          typeof json.summary.loop_status === "string"
        ) {
          info.loopStatus = json.summary.loop_status;
        }
      } catch {
        // ignore JSON/IO errors and leave loopStatus undefined
      }
    }

    tasks.push(info);
  }

  if (tasks.length === 0) {
    console.error(
      `[opencode-orchestrator] no orchestrator tasks found under base directory: ${baseDir}`,
    );
    return;
  }

  tasks.sort((a, b) => a.task.localeCompare(b.task));

  if (opts.format === "json") {
    const payload = tasks.map((t) => ({
      task: t.task,
      rootDir: t.rootDir,
      stateDir: t.stateDir,
      loop_status: t.loopStatus ?? null,
      title: t.title ?? null,
    }));
    // Pretty-print JSON so that it is easy to inspect from the CLI.
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Determine which optional columns are present across all entries.
  const hasAnyLoopStatus = tasks.some((t) => t.loopStatus);
  const hasAnyTitle = tasks.some((t) => t.title);

  // Compute max display width for each column so that rows align.
  const taskWidth = Math.max(...tasks.map((t) => t.task.length));
  const statusWidth = hasAnyLoopStatus
    ? Math.max(
        ...tasks.map((t) =>
          t.loopStatus ? `loop_status=${t.loopStatus}`.length : 0,
        ),
      )
    : 0;
  const titleWidth = hasAnyTitle
    ? Math.max(...tasks.map((t) => (t.title ? `title=${t.title}`.length : 0)))
    : 0;

  for (const t of tasks) {
    const cols: string[] = [t.task.padEnd(taskWidth)];
    if (hasAnyLoopStatus) {
      const s = t.loopStatus ? `loop_status=${t.loopStatus}` : "";
      cols.push(s.padEnd(statusWidth));
    }
    if (hasAnyTitle) {
      const s = t.title ? `title=${t.title}` : "";
      cols.push(s.padEnd(titleWidth));
    }
    console.log(cols.join("  "));
  }
}
