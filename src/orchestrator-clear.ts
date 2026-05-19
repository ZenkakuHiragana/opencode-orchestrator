import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { loadProposals, saveProposals } from "./orchestrator-proposals.js";
import { t } from "./i18n/messages.js";
import { listKnownTasks, suggestRecentTasks } from "./task-resolution.js";

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
  const targetCount =
    Number(clearProposals) +
    Number(Boolean(resolveId)) +
    Number(Boolean(dismissId));
  if (targetCount > 1) {
    throw new Error(t("cli.clear.error.multiple_targets"));
  }

  return { task, clearProposals, yes, resolveId, dismissId };
}

export async function runClear(opts: ClearOptions): Promise<number> {
  const stateDir = getOrchestratorStateDir(opts.task);
  const knownInfos = listKnownTasks();
  const knownTasks = knownInfos.map((info) => info.task);
  if (!knownTasks.includes(opts.task)) {
    const suggestions = suggestRecentTasks(opts.task, knownInfos, 5);
    if (suggestions.length > 0) {
      console.error(
        t("cli.status.error.unknown_task_with_suggestions", {
          input: opts.task,
          candidates: suggestions.join(", "),
        }),
      );
    } else {
      console.error(
        t("cli.status.error.unknown_task_no_suggestions", {
          input: opts.task,
        }),
      );
    }
    return 1;
  }

  const proposalsPath = path.join(stateDir, "proposals.json");
  const proposalsFile = loadProposals(proposalsPath);
  const proposals = proposalsFile.proposals;
  const openProposals = proposals.filter(
    (proposal) => proposal.status === "open",
  );
  const targetProposal = opts.resolveId
    ? proposals.find((proposal) => proposal.id === opts.resolveId)
    : opts.dismissId
      ? proposals.find((proposal) => proposal.id === opts.dismissId)
      : undefined;

  if (!opts.clearProposals && !opts.resolveId && !opts.dismissId) {
    console.error(t("cli.clear.error.no_target"));
    return 1;
  }

  if (opts.clearProposals && openProposals.length === 0) {
    console.error(
      t("cli.clear.info.no_proposals", {
        task: opts.task,
      }),
    );
    return 0;
  }

  if ((opts.resolveId || opts.dismissId) && !targetProposal) {
    console.error(
      t("cli.clear.error.proposal_id_not_found", {
        id: opts.resolveId ?? opts.dismissId ?? "",
      }),
    );
    return 1;
  }

  if (targetProposal && targetProposal.status !== "open") {
    console.error(
      t("cli.clear.error.proposal_already_closed", {
        id: targetProposal.id,
      }),
    );
    return 1;
  }

  if (!opts.yes) {
    const targetCount = opts.clearProposals ? openProposals.length : 1;
    console.error(
      t("cli.clear.info.confirm", {
        task: opts.task,
        count: String(targetCount),
      }),
    );
    console.error(t("cli.clear.info.confirm_hint"));
    return 0;
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
    for (const proposal of openProposals) {
      if (proposal.status === "open") {
        proposal.status = "resolved";
        proposal.resolved_at = now;
        proposal.resolved_by = "cli";
      }
    }
  }

  if (targetProposal) {
    targetProposal.status = opts.dismissId ? "dismissed" : "resolved";
    targetProposal.resolved_at = now;
    targetProposal.resolved_by = "cli";
  }

  saveProposals(proposalsPath, proposalsFile);
  console.error(
    t("cli.clear.info.updated", {
      task: opts.task,
    }),
  );
  return 0;
}
