import type { LoopOptions } from "./cli-args.js";
import { t } from "./i18n/messages.js";
import { runOpencode, runOpencodeBwrap } from "./orchestrator-process.js";
import {
  buildExecutorPrompt,
  withTaskKeyHint,
} from "./orchestrator-prompts.js";
import {
  appendFileArg,
  buildSkipSafeJsonAttachment,
} from "./orchestrator-session.js";
import type { ExecutorAuditorStepResult } from "./orchestrator-step-types.js";
import type { OrchestratorStatus } from "./orchestrator-status.js";
import { saveStatusJson } from "./orchestrator-status.js";
import {
  detectExecutorOpencodeInfraError,
  ensureFailureBudget,
  restartFromSafety,
} from "./orchestrator-step-recovery.js";
import { handleExecutorSnapshotAndAudit } from "./orchestrator-executor-auditor-postprocess.js";

export async function runExecutorAndAuditorStep(
  opts: LoopOptions,
  step: number,
  sessionId: string,
  fileArgs: string[],
  orchLog: string,
  auditRaw: string,
  status: OrchestratorStatus,
  statusPath: string,
  restartCount: number,
  forceTodoWriterNextStep: boolean,
  logDir: string,
): Promise<ExecutorAuditorStepResult> {
  const failureBudget = ensureFailureBudget(status);
  const report = status.last_auditor_report ?? null;
  const isNextAfterAudit =
    !!report && !report.done && step === report.cycle + 1;

  const execFileArgs: string[] = (() => {
    if (!isNextAfterAudit) {
      return fileArgs;
    }
    const hideCommandPolicyConcept =
      opts.dangerouslySkipCommandPolicy || opts.bwrapSkipCommandPolicy;
    if (!hideCommandPolicyConcept) {
      return appendFileArg(fileArgs, statusPath);
    }
    const sanitizedStatusPath = buildSkipSafeJsonAttachment(statusPath);
    return sanitizedStatusPath
      ? appendFileArg(fileArgs, sanitizedStatusPath)
      : fileArgs;
  })();

  const execPromptBase = buildExecutorPrompt(
    isNextAfterAudit,
    status,
    opts.dangerouslySkipCommandPolicy || opts.bwrapSkipCommandPolicy,
  );
  const execPrompt = withTaskKeyHint(execPromptBase, opts.task);
  const execEnv: NodeJS.ProcessEnv | undefined = (() => {
    const env: NodeJS.ProcessEnv = {};
    if (opts.dangerouslySkipCommandPolicy || opts.bwrapSkipCommandPolicy) {
      env.OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY = "1";
    }
    return Object.keys(env).length > 0 ? env : undefined;
  })();

  const execArgs = [
    "run",
    "--command",
    "orch-exec",
    "--session",
    sessionId,
    ...execFileArgs,
    "--",
    execPrompt,
  ];

  const execRes = opts.bwrapSkipCommandPolicy
    ? await runOpencodeBwrap(opts.bwrapArgs, execArgs, orchLog, true, execEnv)
    : await runOpencode(execArgs, orchLog, true, execEnv);

  const infraError = detectExecutorOpencodeInfraError(
    execRes.stdout,
    execRes.stderr,
    execRes.code,
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

    failureBudget.last_failure_kind = "executor_opencode_error";
    const summaryKey =
      infraError.kind === "unexpected_error"
        ? "loop.executor.failure.opencode_unexpected_summary"
        : "loop.executor.failure.opencode_reasoning_summary";
    failureBudget.last_failure_summary = t(summaryKey, {
      message: infraError.message,
    });
    saveStatusJson(statusPath, status);

    const maxPerSession = 3;

    if (consecutiveInSession < maxPerSession) {
      console.error(
        t("loop.executor.error.opencode_retry", {
          kind: infraError.kind,
          current: consecutiveInSession,
          max: maxPerSession,
        }),
      );
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep,
        done: false,
        abortLoop: false,
        skipAuditorThisStep: true,
      };
    }

    console.error(
      t("loop.executor.error.opencode_restart", {
        current: consecutiveInSession,
      }),
    );

    if (restartCount >= opts.maxRestarts) {
      console.error(
        t("loop.executor.error.opencode_restart_limit_reached", {
          maxRestarts: opts.maxRestarts,
        }),
      );
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep,
        done: false,
        abortLoop: true,
        skipAuditorThisStep: false,
      };
    }

    const newRestartCount = restartCount + 1;
    const newSessionId = await restartFromSafety(
      "executor",
      opts,
      logDir,
      fileArgs,
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
      forceTodoWriterNextStep,
      done: false,
      abortLoop: false,
      skipAuditorThisStep: true,
    };
  }

  const safetyTripped = execRes.stdout.includes(
    "I'm sorry, but I cannot assist with that request.",
  );
  if (safetyTripped) {
    failureBudget.executor_safety_restarts += 1;
    if (failureBudget.executor_safety_last_session_id === sessionId) {
      failureBudget.executor_safety_consecutive_in_session =
        (failureBudget.executor_safety_consecutive_in_session ?? 0) + 1;
    } else {
      failureBudget.executor_safety_last_session_id = sessionId;
      failureBudget.executor_safety_consecutive_in_session = 1;
    }
    failureBudget.last_failure_kind = "executor_safety";
    failureBudget.last_failure_summary =
      "executor が safety trip を起こしたためセッションを再開した";
    saveStatusJson(statusPath, status);
    console.error(
      "[opencode-orchestrator] executor の出力で safety trip を検出しました。",
    );
    if (restartCount >= opts.maxRestarts) {
      console.error(
        `[opencode-orchestrator] MAX_RESTARTS=${opts.maxRestarts} に到達したため、ループを中断します。`,
      );
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep,
        done: false,
        abortLoop: true,
        skipAuditorThisStep: false,
      };
    }

    const newRestartCount = restartCount + 1;
    const consecutiveInSession =
      failureBudget.executor_safety_consecutive_in_session ?? 1;
    const shouldRestartSession = consecutiveInSession >= 3;
    const newSessionId = shouldRestartSession
      ? await restartFromSafety(
          "executor",
          opts,
          logDir,
          fileArgs,
          sessionId,
          status,
          statusPath,
          newRestartCount,
        )
      : sessionId;

    if (shouldRestartSession) {
      console.error(
        `[opencode-orchestrator] executor の safety trip が同一セッション内で ${consecutiveInSession} 回連続したため、新しいセッションを開始します。`,
      );
      failureBudget.executor_safety_consecutive_in_session = 0;
      failureBudget.executor_safety_last_session_id = newSessionId;
      saveStatusJson(statusPath, status);
    }

    return {
      sessionId: newSessionId,
      restartCount: newRestartCount,
      forceTodoWriterNextStep,
      done: false,
      abortLoop: false,
      skipAuditorThisStep: true,
    };
  }

  if (execRes.code !== 0) {
    console.error(
      "[opencode-orchestrator] executor ステップが非 0 ステータスで終了しました。",
    );
  }

  return handleExecutorSnapshotAndAudit(
    opts,
    step,
    sessionId,
    fileArgs,
    auditRaw,
    status,
    statusPath,
    restartCount,
    forceTodoWriterNextStep,
    execRes.stdout,
  );
}
