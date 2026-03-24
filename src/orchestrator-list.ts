import * as fs from "node:fs";
import * as path from "node:path";

import {
  getOrchestratorBaseDir,
  getOrchestratorRoot,
  getOrchestratorStateDir,
} from "./orchestrator-paths.js";
import type { ListOptions } from "./cli-args.js";
import { loadStatusJson } from "./orchestrator-status.js";

interface TaskListEntry {
  task: string;
  rootDir: string;
  stateDir: string;
  loopStatus?: string;
  summary?: string;
}

function firstNonEmptyLine(input: string): string | undefined {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0];
}

function extractSummaryFromSpec(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  let inGoalSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (/^##\s+/.test(line)) {
      if (line === "## 目標" || line === "## Goal") {
        inGoalSection = true;
        continue;
      }
      if (inGoalSection) {
        break;
      }
      continue;
    }
    if (inGoalSection && !line.startsWith("#")) {
      return line;
    }
  }

  return firstNonEmptyLine(markdown.replace(/^#.*$/gm, "").trim());
}

export async function runList(opts: ListOptions): Promise<void> {
  if (opts.showProposals && opts.task) {
    const stateDir = getOrchestratorStateDir(opts.task);
    const statusPath = path.join(stateDir, "status.json");
    const status = loadStatusJson(statusPath);
    const proposals = Array.isArray(status.proposals) ? status.proposals : [];

    if (opts.format === "json") {
      console.log(
        JSON.stringify(
          {
            task: opts.task,
            proposals,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (proposals.length === 0) {
      console.error(
        `[opencode-orchestrator] no proposals found for task "${opts.task}".`,
      );
      return;
    }

    console.error(`[opencode-orchestrator] proposals for task "${opts.task}":`);
    for (const p of proposals) {
      console.error(
        `  - [${p.source}] kind=${p.kind} cycle=${p.cycle} id=${p.id}`,
      );
      console.error(`    summary: ${p.summary}`);
      if (p.details) {
        const firstLine = String(p.details).split(/\r?\n/, 1)[0];
        console.error(`    details: ${firstLine}`);
      }
    }
    return;
  }

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

    const acceptancePath = path.join(stateDir, "acceptance-index.json");
    if (fs.existsSync(acceptancePath)) {
      try {
        const raw = fs.readFileSync(acceptancePath, "utf8");
        const json = JSON.parse(raw) as { north_star?: unknown };
        if (typeof json.north_star === "string" && json.north_star.trim()) {
          info.summary = json.north_star.trim().replace(/\s+/g, " ");
        }
      } catch {
        // ignore JSON/IO errors and leave summary undefined
      }
    }

    if (!info.summary) {
      const specPath = path.join(stateDir, "spec.md");
      if (fs.existsSync(specPath)) {
        try {
          const raw = fs.readFileSync(specPath, "utf8");
          const summary = extractSummaryFromSpec(raw);
          if (summary) {
            info.summary = summary.replace(/\s+/g, " ");
          }
        } catch {
          // ignore IO errors and leave summary undefined
        }
      }
    }

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
      summary: t.summary ?? null,
    }));
    // Pretty-print JSON so that it is easy to inspect from the CLI.
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  // Determine which optional columns are present across all entries.
  const hasAnyLoopStatus = tasks.some((t) => t.loopStatus);
  const hasAnySummary = tasks.some((t) => t.summary);

  // Compute max display width for each column so that rows align.
  const taskWidth = Math.max(...tasks.map((t) => t.task.length));
  const statusWidth = hasAnyLoopStatus
    ? Math.max(
        ...tasks.map((t) =>
          t.loopStatus ? `loop_status=${t.loopStatus}`.length : 0,
        ),
      )
    : 0;
  const summaryWidth = hasAnySummary
    ? Math.max(
        ...tasks.map((t) => (t.summary ? `summary=${t.summary}`.length : 0)),
      )
    : 0;

  for (const t of tasks) {
    const cols: string[] = [t.task.padEnd(taskWidth)];
    if (hasAnyLoopStatus) {
      const s = t.loopStatus ? `loop_status=${t.loopStatus}` : "";
      cols.push(s.padEnd(statusWidth));
    }
    if (hasAnySummary) {
      const s = t.summary ? `summary=${t.summary}` : "";
      cols.push(s.padEnd(summaryWidth));
    }
    console.log(cols.join("  "));
  }
}
