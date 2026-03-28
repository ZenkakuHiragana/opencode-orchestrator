import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { loadProposals, saveProposals } from "./orchestrator-proposals.js";

export interface ClearOptions {
  task: string;
  clearProposals: boolean;
  yes: boolean;
  resolveId?: string;
  dismissId?: string;
}

export function printClearUsage(): void {
  console.error(
    "使い方: opencode-orchestrator clear --task <task-name> [--proposals | --resolve <id> | --dismiss <id>] [-y]\n" +
      "\n" +
      "指定したタスクの proposals.json を更新します。\n" +
      "\n" +
      "オプション:\n" +
      "  --task <name>   対象となるタスクキー (例: 'my-task')\n" +
      "  --proposals     すべての open proposal を resolved にする\n" +
      "  --resolve <id>  指定した proposal を resolved にする\n" +
      "  --dismiss <id>  指定した proposal を dismissed にする\n" +
      "  -y              確認なしで削除を実行する",
  );
}

export function parseClearArgs(argv: string[]): ClearOptions {
  let task: string | undefined;
  let clearProposals = false;
  let yes = false;
  let resolveId: string | undefined;
  let dismissId: string | undefined;

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
    } else if (arg === "--resolve") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--resolve requires a proposal id");
      }
      resolveId = next;
    } else if (arg === "--dismiss") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--dismiss requires a proposal id");
      }
      dismissId = next;
    } else if (arg === "-y") {
      yes = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option for clear: ${arg}`);
    } else {
      throw new Error(`unexpected argument for clear: ${arg}`);
    }
  }

  if (!task) {
    throw new Error("--task は clear サブコマンドで必須です");
  }
  if (!clearProposals && !resolveId && !dismissId) {
    throw new Error(
      "clear には --proposals, --resolve, --dismiss のいずれかが必要です",
    );
  }

  return { task, clearProposals, yes, resolveId, dismissId };
}

export async function runClear(opts: ClearOptions): Promise<void> {
  const stateDir = getOrchestratorStateDir(opts.task);
  const proposalsPath = path.join(stateDir, "proposals.json");
  const proposalsFile = loadProposals(proposalsPath);
  const proposals = proposalsFile.proposals;

  if (!opts.clearProposals && !opts.resolveId && !opts.dismissId) {
    console.error(
      "[opencode-orchestrator] clear: 実行対象が指定されていません (--proposals が必要です)",
    );
    return;
  }

  if (proposals.length === 0) {
    console.error(
      `[opencode-orchestrator] タスク "${opts.task}" には削除対象の proposal はありません。`,
    );
    return;
  }

  if (!opts.yes) {
    console.error(
      `[opencode-orchestrator] タスク "${opts.task}" から ${proposals.length} 件の proposal を削除しようとしています。`,
    );
    console.error(
      "[opencode-orchestrator] 本当に削除してよい場合は -y を付けてもう一度実行してください。",
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
        `[opencode-orchestrator] 既存の proposal をバックアップしました: ${backupPath}`,
      );
    } catch {
      console.error(
        "[opencode-orchestrator] WARN: proposal のバックアップに失敗しました。バックアップなしで削除を続行します。",
      );
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
    `[opencode-orchestrator] タスク "${opts.task}" の proposal を更新しました。`,
  );
}
