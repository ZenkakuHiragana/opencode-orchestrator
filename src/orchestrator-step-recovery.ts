import { runOpencode } from "./orchestrator-process.js";
import type { LoopOptions } from "./cli-args.js";
import type {
  FailureBudgetSnapshot,
  OrchestratorStatus,
} from "./orchestrator-status.js";
import { saveStatusJson } from "./orchestrator-status.js";
import { restartSession } from "./orchestrator-session.js";
import type { ExecutorOpencodeInfraError } from "./orchestrator-step-types.js";

export function ensureFailureBudget(
  status: OrchestratorStatus,
): FailureBudgetSnapshot {
  if (!status.failure_budget) {
    status.failure_budget = {
      todo_writer_safety_restarts: 0,
      executor_safety_restarts: 0,
      executor_safety_consecutive_in_session: 0,
      executor_safety_last_session_id: status.last_session_id,
      executor_opencode_error_consecutive_in_session: 0,
      executor_opencode_error_last_session_id: status.last_session_id,
      consecutive_env_blocked: status.consecutive_env_blocked ?? 0,
      consecutive_audit_failures: 0,
      consecutive_verification_gaps: 0,
      consecutive_contract_gaps: 0,
      semantic_noop_replans: 0,
    };
  }
  status.failure_budget.semantic_noop_replans ??= 0;
  return status.failure_budget;
}

export function detectExecutorOpencodeInfraError(
  stdout: string,
  stderr?: string,
  code?: number | null,
): ExecutorOpencodeInfraError | null {
  const combinedRaw = `${stdout ?? ""}\n${stderr ?? ""}`;
  const combined = combinedRaw.replace(/\u001b\[[0-9;]*m/g, "");

  if (combined.includes("Error: Unexpected error, check log file at ")) {
    const line = combined
      .split(/\r?\n/)
      .find((l) => l.includes("Error: Unexpected error, check log file at "));
    return {
      kind: "unexpected_error",
      message: (
        line || "Error: Unexpected error, check log file at <log>"
      ).trim(),
    };
  }

  const hasReasoningItemPrefix = combined.includes("Error: Item ");
  const hasReasoningItemSuffix = combined.includes(
    "was provided without its required following item.",
  );
  if (hasReasoningItemPrefix && hasReasoningItemSuffix) {
    const idx = combined.indexOf("Error: Item ");
    const endIdx = combined.indexOf("\n", idx);
    const line = combined.slice(idx, endIdx === -1 ? undefined : endIdx).trim();
    return {
      kind: "reasoning_item_missing",
      message: line,
    };
  }

  const hasNonZeroExit = typeof code === "number" ? code !== 0 : code == null;
  if (hasNonZeroExit && combined.includes("Error:")) {
    const line = combined.split(/\r?\n/).find((l) => l.includes("Error:"));
    return {
      kind: "unexpected_error",
      message: (line || "Error: <unknown opencode CLI error>").trim(),
    };
  }

  return null;
}

export async function restartFromSafety(
  context: "todo-writer" | "executor",
  opts: LoopOptions,
  logDir: string,
  fileArgsForRestart: string[],
  sessionId: string,
  status: OrchestratorStatus,
  statusPath: string,
  restartCount: number,
): Promise<string> {
  const safeExport = `${logDir}/orchestrator_session_${Date.now().toString()}_restart${restartCount}_old.json`;
  console.error(
    `[opencode-orchestrator] 既存のセッション状態をエクスポートします: ${safeExport}`,
  );
  const exportOld = await runOpencode(["export", sessionId], safeExport);
  if (exportOld.code !== 0) {
    const warnContext =
      context === "todo-writer" ? "todo-writer restart" : "restart";
    console.error(
      `[opencode-orchestrator] WARN: ${warnContext} 前のセッション状態のエクスポートに失敗しました。`,
    );
  }

  const { newSessionId, newTitle } = await restartSession(
    opts,
    logDir,
    fileArgsForRestart,
    sessionId,
  );
  if (newSessionId) {
    status.last_session_id = newSessionId;
    saveStatusJson(statusPath, status);
    const label = context === "todo-writer" ? " after todo-writer restart" : "";
    console.error(
      `[opencode-orchestrator] 新しいセッションに切り替えました${label ? " (todo-writer restart 後)" : ""}: ${newSessionId} (title: ${newTitle})`,
    );
    return newSessionId;
  }

  const warnContext =
    context === "todo-writer" ? "todo-writer restart" : "restart";
  console.error(
    `[opencode-orchestrator] WARN: ${warnContext} 後の新しいセッション ID を特定できませんでした。既存のセッションを使い続けます。`,
  );
  saveStatusJson(statusPath, status);
  return sessionId;
}
