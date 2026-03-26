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
    "使い方: opencode-orchestrator clear --task <task-name> --proposals [-y]\n" +
      "\n" +
      "指定したタスクの orchestrator 状態から proposal を削除します。現時点では status.json.proposals だけが対象です。\n" +
      "\n" +
      "オプション:\n" +
      "  --task <name>   対象となるタスクキー (例: 'my-task')\n" +
      "  --proposals     status.json.proposals を削除する\n" +
      "  -y              確認なしで削除を実行する",
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
    throw new Error("--task は clear サブコマンドで必須です");
  }
  if (!clearProposals) {
    throw new Error("現在 clear がサポートしているのは --proposals のみです");
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

  status.proposals = [];
  status.consecutive_env_blocked = 0;
  if (status.failure_budget) {
    status.failure_budget.consecutive_env_blocked = 0;
  }
  saveStatusJson(statusPath, status);
  console.error(
    `[opencode-orchestrator] タスク "${opts.task}" から ${proposals.length} 件の proposal を削除しました。`,
  );
}
