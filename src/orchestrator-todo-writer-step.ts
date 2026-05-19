import * as fs from "node:fs";
import * as path from "node:path";

import type { LoopOptions } from "./cli-args.js";
import { t } from "./i18n/messages.js";
import { runOpencode } from "./orchestrator-process.js";
import {
  buildTodoWriterPrompt,
  withTaskKeyHint,
} from "./orchestrator-prompts.js";
import {
  createProposalEntry,
  getOpenProposals,
  loadProposals,
  saveProposals,
} from "./orchestrator-proposals.js";
import {
  appendFileArg,
  buildSkipSafeJsonAttachment,
} from "./orchestrator-session.js";
import type { TodoWriterStepResult } from "./orchestrator-step-types.js";
import type { OrchestratorStatus } from "./orchestrator-status.js";
import { saveStatusJson } from "./orchestrator-status.js";
import {
  detectExecutorOpencodeInfraError,
  ensureFailureBudget,
  restartFromSafety,
} from "./orchestrator-step-recovery.js";
import {
  hasMeaningfulTodoChangeForRequirement,
  loadMinimalTodos,
  normalizeTodoFile,
  readTodoSummary,
  validateTodoCoverage,
} from "./orchestrator-step-todo-state.js";

export async function maybeRunTodoWriterStep(
  opts: LoopOptions,
  step: number,
  stepId: string,
  stateDir: string,
  logDir: string,
  acceptanceIndexPath: string,
  sessionId: string,
  fileArgs: string[],
  status: OrchestratorStatus,
  statusPath: string,
  restartCount: number,
  forceTodoWriterNextStep: boolean,
): Promise<TodoWriterStepResult> {
  const failureBudget = ensureFailureBudget(status);
  const proposalsPath = path.join(path.dirname(statusPath), "proposals.json");
  const openProposals = getOpenProposals(loadProposals(proposalsPath));
  const todoPath = path.join(stateDir, "todo.json");
  const prevTodoNormalized = normalizeTodoFile(todoPath);
  const prevTodosMinimal = loadMinimalTodos(todoPath);
  const needReplan = forceTodoWriterNextStep || openProposals.length > 0;
  if (!fs.existsSync(acceptanceIndexPath) || (step !== 1 && !needReplan)) {
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep,
      restartedSession: false,
      abortLoop: false,
      skipExecutorThisStep: false,
    };
  }

  const todowriterLog = path.join(logDir, `todowriter_step_${stepId}.txt`);
  const hideCommandPolicyConcept =
    opts.dangerouslySkipCommandPolicy || opts.bwrapSkipCommandPolicy;
  const todowriterPromptBase = buildTodoWriterPrompt(
    status,
    openProposals,
    hideCommandPolicyConcept,
  );
  const todowriterPrompt = withTaskKeyHint(todowriterPromptBase, opts.task);
  const todoEnv: NodeJS.ProcessEnv | undefined = (() => {
    const env: NodeJS.ProcessEnv = {};
    if (opts.dangerouslySkipCommandPolicy || opts.bwrapSkipCommandPolicy) {
      env.OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY = "1";
    }
    return Object.keys(env).length > 0 ? env : undefined;
  })();
  const todoStatusAttachment =
    hideCommandPolicyConcept && fs.existsSync(statusPath)
      ? buildSkipSafeJsonAttachment(statusPath)
      : statusPath;
  const todoFileArgs =
    hideCommandPolicyConcept && !todoStatusAttachment
      ? fileArgs
      : appendFileArg(fileArgs, todoStatusAttachment ?? statusPath);
  const planRes = await runOpencode(
    [
      "run",
      "--command",
      "orch-todo-write",
      "--session",
      sessionId,
      ...todoFileArgs,
      "--",
      todowriterPrompt,
    ],
    todowriterLog,
    true,
    todoEnv,
  );

  const infraError = detectExecutorOpencodeInfraError(
    planRes.stdout,
    planRes.stderr,
    planRes.code,
  );
  if (infraError) {
    if (failureBudget.executor_opencode_error_last_session_id === sessionId) {
      failureBudget.executor_opencode_error_consecutive_in_session =
        (failureBudget.executor_opencode_error_consecutive_in_session ?? 0) + 1;
    } else {
      failureBudget.executor_opencode_error_last_session_id = sessionId;
      failureBudget.executor_opencode_error_consecutive_in_session = 1;
    }

    const consecutiveInSession =
      failureBudget.executor_opencode_error_consecutive_in_session ?? 1;

    failureBudget.last_failure_kind = "todo_writer_opencode_error";
    failureBudget.last_failure_summary =
      "todo-writer 実行中に OpenCode 実行エラーが発生しました: " +
      infraError.message;
    saveStatusJson(statusPath, status);

    const maxPerSession = 3;

    if (consecutiveInSession < maxPerSession) {
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep: true,
        restartedSession: false,
        abortLoop: false,
        skipExecutorThisStep: true,
      };
    }

    if (restartCount >= opts.maxRestarts) {
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep,
        restartedSession: false,
        abortLoop: true,
        skipExecutorThisStep: true,
      };
    }

    const newRestartCount = restartCount + 1;
    const newSessionId = await restartFromSafety(
      "todo-writer",
      opts,
      logDir,
      appendFileArg(fileArgs, statusPath),
      sessionId,
      status,
      statusPath,
      newRestartCount,
    );

    failureBudget.executor_opencode_error_consecutive_in_session = 0;
    failureBudget.executor_opencode_error_last_session_id = newSessionId;
    saveStatusJson(statusPath, status);

    return {
      sessionId: newSessionId,
      restartCount: newRestartCount,
      forceTodoWriterNextStep: false,
      restartedSession: true,
      abortLoop: false,
      skipExecutorThisStep: true,
    };
  }

  const todowriterSafety = planRes.stdout.includes(
    "I'm sorry, but I cannot assist with that request.",
  );
  if (todowriterSafety) {
    failureBudget.todo_writer_safety_restarts += 1;
    failureBudget.last_failure_kind = "todo_writer_safety";
    failureBudget.last_failure_summary =
      "todo-writer が safety trip を起こしたためセッションを再開した";
    saveStatusJson(statusPath, status);
    console.error(
      "[opencode-orchestrator] todo-writer の出力で safety trip を検出しました。セッションを再開します。",
    );
    if (restartCount >= opts.maxRestarts) {
      console.error(
        `[opencode-orchestrator] todo-writer 実行中に MAX_RESTARTS=${opts.maxRestarts} に到達したため、ループを中断します。`,
      );
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep,
        restartedSession: false,
        abortLoop: true,
        skipExecutorThisStep: true,
      };
    }

    const newRestartCount = restartCount + 1;
    const newSessionId = await restartFromSafety(
      "todo-writer",
      opts,
      logDir,
      appendFileArg(fileArgs, statusPath),
      sessionId,
      status,
      statusPath,
      newRestartCount,
    );

    return {
      sessionId: newSessionId,
      restartCount: newRestartCount,
      forceTodoWriterNextStep: false,
      restartedSession: true,
      abortLoop: false,
      skipExecutorThisStep: true,
    };
  }

  if (planRes.code !== 0) {
    failureBudget.last_failure_kind = "todo_writer_failed";
    failureBudget.last_failure_summary =
      "todo-writer が non-zero exit を返したため再計画状態を維持する";
    saveStatusJson(statusPath, status);
    console.error(
      "[opencode-orchestrator] todo-writer ステップが非 0 ステータスで終了しました。",
    );
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep: true,
      restartedSession: false,
      abortLoop: false,
      skipExecutorThisStep: true,
    };
  }

  const todoSummary = readTodoSummary(todoPath);
  if (!todoSummary.ok) {
    failureBudget.last_failure_kind = "todo_writer_invalid_todo_cache";
    failureBudget.last_failure_summary =
      "todo-writer が有効な todo.json を残さなかったため再計画状態を維持する";
    saveStatusJson(statusPath, status);
    console.error(
      `[opencode-orchestrator] todo-writer が生成した todo.json が無効です: ${todoSummary.reason}`,
    );
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep: true,
      restartedSession: false,
      abortLoop: false,
      skipExecutorThisStep: true,
    };
  }

  const coverageCheck = validateTodoCoverage(
    acceptanceIndexPath,
    status,
    todoPath,
  );
  if (!coverageCheck.ok) {
    failureBudget.last_failure_kind = "todo_writer_coverage_invariant_failed";
    failureBudget.last_failure_summary =
      "todo-writer が coverage invariants を満たさない todo.json を生成したため再計画状態を維持する: " +
      coverageCheck.reason;
    saveStatusJson(statusPath, status);
    console.error(
      `[opencode-orchestrator] todo-writer が生成した todo.json が coverage invariants に違反しています: ${coverageCheck.reason}`,
    );
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep: true,
      restartedSession: false,
      abortLoop: false,
      skipExecutorThisStep: true,
    };
  }

  const nextTodoNormalized = normalizeTodoFile(todoPath);
  const todoChanged = prevTodoNormalized !== nextTodoNormalized;
  const nextTodosMinimal = loadMinimalTodos(todoPath);

  console.error(
    `[opencode-orchestrator] todo-writer todos: total=${todoSummary.total} ` +
      `pending=${todoSummary.pending} in_progress=${todoSummary.inProgress} ` +
      `completed=${todoSummary.completed} cancelled=${todoSummary.cancelled}`,
  );

  const proposalsFile = loadProposals(proposalsPath);
  const hasOpenAutoResolvable = proposalsFile.proposals.some(
    (proposal) => proposal.status === "open" && proposal.auto_resolvable,
  );

  if (hasOpenAutoResolvable && !todoChanged) {
    failureBudget.last_failure_kind = "todo_writer_noop_replan";
    failureBudget.last_failure_summary =
      "todo-writer が open な auto_resolvable proposals を抱えたまま再実行されましたが、todo.json に有意な変更がありません。";
    saveStatusJson(statusPath, status);
    console.error(
      "[opencode-orchestrator] todo-writer 再計画が no-op でした。open な auto_resolvable proposals を残したまま Executor をスキップし、次のステップでも再計画を継続します。",
    );
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep: true,
      restartedSession: false,
      abortLoop: false,
      skipExecutorThisStep: true,
    };
  }

  const now = new Date().toISOString();
  const updatedProposals = {
    version: proposalsFile.version,
    proposals: proposalsFile.proposals.map((proposal) => {
      if (proposal.status !== "open" || !proposal.auto_resolvable) {
        return proposal;
      }

      let shouldResolve = false;

      if (proposal.kind === "audit_failure") {
        if (nextTodosMinimal) {
          shouldResolve = proposal.related_requirement_ids.some((reqId) =>
            hasMeaningfulTodoChangeForRequirement(
              reqId,
              prevTodosMinimal,
              nextTodosMinimal,
            ),
          );
        }
      } else {
        shouldResolve = todoChanged;
      }

      if (!shouldResolve) {
        return proposal;
      }

      return {
        ...proposal,
        status: "resolved" as const,
        resolved_at: now,
        resolved_by: "auto" as const,
      };
    }),
  };

  saveProposals(proposalsPath, updatedProposals);
  failureBudget.consecutive_contract_gaps = 0;
  failureBudget.consecutive_verification_gaps = 0;
  saveStatusJson(statusPath, status);

  return {
    sessionId,
    restartCount,
    forceTodoWriterNextStep: false,
    restartedSession: false,
    abortLoop: false,
    skipExecutorThisStep: false,
  };
}
