import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { loadProposals, saveProposals } from "./orchestrator-proposals.js";
import { t } from "./i18n/messages.js";

export interface ClearOptions {
  task: string;
  clearProposals: boolean;
  yes: boolean;
  resolveId?: string;
  dismissId?: string;
}

export function printClearUsage(): void {
  console.error(t("cli.clear.usage"));
}

export function parseClearArgs(argv: string[]): ClearOptions {
  let task: string | undefined;
  let clearProposals = false;
  let yes = false;
  let resolveId: string | undefined;
  let dismissId: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--task" || arg === "-t") {
      const next = argv[++i];
      if (!next) {
        throw new Error(t("cli.clear.error.missing_task_name"));
      }
      task = next;
    } else if (arg === "--proposals") {
      clearProposals = true;
    } else if (arg === "--resolve") {
      const next = argv[++i];
      if (!next) {
        throw new Error(t("cli.clear.error.missing_resolve_id"));
      }
      resolveId = next;
    } else if (arg === "--dismiss") {
      const next = argv[++i];
      if (!next) {
        throw new Error(t("cli.clear.error.missing_dismiss_id"));
      }
      dismissId = next;
    } else if (arg === "-y") {
      yes = true;
    } else if (arg.startsWith("-")) {
      throw new Error(
        t("cli.clear.error.unknown_option", {
          option: arg,
        }),
      );
    } else {
      throw new Error(
        t("cli.clear.error.unexpected_arg", {
          arg,
        }),
      );
    }
  }

  if (!task) {
    throw new Error(t("cli.clear.error.missing_task"));
  }
  if (!clearProposals && !resolveId && !dismissId) {
    throw new Error(t("cli.clear.error.no_target"));
  }

  return { task, clearProposals, yes, resolveId, dismissId };
}

export async function runClear(opts: ClearOptions): Promise<void> {
  const stateDir = getOrchestratorStateDir(opts.task);
  const proposalsPath = path.join(stateDir, "proposals.json");
  const proposalsFile = loadProposals(proposalsPath);
  const proposals = proposalsFile.proposals;

  if (!opts.clearProposals && !opts.resolveId && !opts.dismissId) {
    console.error(t("cli.clear.error.no_target"));
    return;
  }

  if (proposals.length === 0) {
    console.error(
      t("cli.clear.info.no_proposals", {
        task: opts.task,
      }),
    );
    return;
  }

  if (!opts.yes) {
    console.error(
      t("cli.clear.info.confirm", {
        task: opts.task,
        count: String(proposals.length),
      }),
    );
    console.error(t("cli.clear.info.confirm_hint"));
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
        t("cli.clear.info.backup_created", {
          path: backupPath,
        }),
      );
    } catch {
      console.error(t("cli.clear.warn.backup_failed"));
    }
  }

  const now = new Date().toISOString();
  if (opts.clearProposals) {
    for (const proposal of proposalsFile.proposals) {
      if (proposal.status === "open") {
        proposal.status = "resolved";
        proposal.resolved_at = now;
        proposal.resolved_by = "cli";
      }
    }
  }

  if (opts.resolveId || opts.dismissId) {
    const target = proposalsFile.proposals.find((proposal) => {
      if (opts.resolveId) return proposal.id === opts.resolveId;
      return proposal.id === opts.dismissId;
    });
    if (!target) {
      throw new Error(
        `proposal id not found: ${opts.resolveId ?? opts.dismissId}`,
      );
    }
    if (target.status !== "open") {
      throw new Error(`proposal is already closed: ${target.id}`);
    }
    target.status = opts.dismissId ? "dismissed" : "resolved";
    target.resolved_at = now;
    target.resolved_by = "cli";
  }

  saveProposals(proposalsPath, proposalsFile);
  console.error(
    t("cli.clear.info.updated", {
      task: opts.task,
    }),
  );
}
