import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { loadStatusJson, saveStatusJson } from "./orchestrator-status.js";

export interface ClearOptions {
  task: string;
  clearProposals: boolean;
  yes: boolean;
}

export function printClearUsage(): void {
  console.error(
    "Usage: opencode-orchestrator clear --task <task-name> --proposals [-y]\n" +
      "\n" +
      "Clear orchestrator state for a given task. Currently only proposal entries in status.json are supported.\n" +
      "\n" +
      "Options:\n" +
      "  --task <name>   Target task key (e.g., 'my-task')\n" +
      "  --proposals     Clear status.json.proposals for the task\n" +
      "  -y              Do not prompt for confirmation",
  );
}

export function parseClearArgs(argv: string[]): ClearOptions {
  let task: string | undefined;
  let clearProposals = false;
  let yes = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--task") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--task requires a task name");
      }
      task = next;
    } else if (arg === "--proposals") {
      clearProposals = true;
    } else if (arg === "-y") {
      yes = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option for clear: ${arg}`);
    } else {
      throw new Error(`unexpected argument for clear: ${arg}`);
    }
  }

  if (!task) {
    throw new Error("--task is required for clear");
  }
  if (!clearProposals) {
    throw new Error("clear currently supports only --proposals");
  }

  return { task, clearProposals, yes };
}

export async function runClear(opts: ClearOptions): Promise<void> {
  const stateDir = getOrchestratorStateDir(opts.task);
  const statusPath = path.join(stateDir, "status.json");
  const status = loadStatusJson(statusPath);
  const proposals = Array.isArray(status.proposals) ? status.proposals : [];

  if (!opts.clearProposals) {
    console.error(
      "[opencode-orchestrator] clear: no operation selected (expected --proposals)",
    );
    return;
  }

  if (proposals.length === 0) {
    console.error(
      `[opencode-orchestrator] no proposals to clear for task "${opts.task}".`,
    );
    return;
  }

  if (!opts.yes) {
    console.error(
      `[opencode-orchestrator] ${proposals.length} proposal(s) will be cleared for task "${opts.task}".`,
    );
    console.error(
      "[opencode-orchestrator] Re-run with -y if you are sure you want to clear them.",
    );
    return;
  }

  const backupDir = path.join(stateDir, "..", "logs");
  try {
    fs.mkdirSync(backupDir, { recursive: true });
  } catch {
    // best-effort; if backup directory cannot be created, continue without backup
  }

  if (fs.existsSync(backupDir) && fs.statSync(backupDir).isDirectory()) {
    const backupPath = path.join(
      backupDir,
      `proposals_backup_${Date.now().toString()}.json`,
    );
    try {
      fs.writeFileSync(
        backupPath,
        JSON.stringify({ task: opts.task, proposals }, null, 2),
        "utf8",
      );
      console.error(
        `[opencode-orchestrator] backed up existing proposals to ${backupPath}`,
      );
    } catch {
      console.error(
        "[opencode-orchestrator] WARN: failed to write proposals backup; continuing without backup.",
      );
    }
  }

  status.proposals = [];
  saveStatusJson(statusPath, status);
  console.error(
    `[opencode-orchestrator] cleared ${proposals.length} proposal(s) for task "${opts.task}".`,
  );
}
