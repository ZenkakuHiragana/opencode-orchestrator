import * as fs from "node:fs";
import * as path from "node:path";

import type { LoopOptions } from "./cli-args.js";
import { t } from "./i18n/messages.js";
import { runOpencode, runOpencodeBwrap } from "./orchestrator-process.js";
import {
  buildAuditPrompt,
  buildExecutorPrompt,
  buildTodoWriterPrompt,
  withTaskKeyHint,
} from "./orchestrator-prompts.js";
import {
  parseAuditResult,
  type AuditMode,
  type AuditSummary,
} from "./orchestrator-audit.js";
import type {
  AuditorRequirementSnapshot,
  FailureBudgetSnapshot,
  AuditorReportSnapshot,
  ExecutorStepSnapshot,
  OrchestratorStatus,
} from "./orchestrator-status.js";
import {
  getExecutorVerificationEvidence,
  parseExecutorStepSnapshot,
  saveStatusJson,
} from "./orchestrator-status.js";
import {
  createProposalEntry,
  type ProposalEntry,
  getOpenProposals,
  hasOpenNonAutoResolvableProposals,
  loadProposals,
  resolveAutoResolvableProposals,
  saveProposals,
} from "./orchestrator-proposals.js";
import {
  appendFileArg,
  buildSkipSafeJsonAttachment,
  findSessionIdByTitle,
  restartSession,
} from "./orchestrator-session.js";

export type TodoWriterStepResult = {
  sessionId: string;
  restartCount: number;
  forceTodoWriterNextStep: boolean;
  restartedSession: boolean;
  abortLoop: boolean;
  // When true, the executor/auditor phase for this step MUST be skipped
  // entirely and the loop should continue to the next step. This is used
  // for cases where todo-writer produced an unusable or coverage-breaking
  // todo.json (for example invalid shape or coverage invariant violations),
  // so that we never run the Executor against a known-bad canonical todo
  // cache.
  skipExecutorThisStep: boolean;
};

export type ExecutorAuditorStepResult = {
  sessionId: string;
  restartCount: number;
  forceTodoWriterNextStep: boolean;
  done: boolean;
  abortLoop: boolean;
  skipAuditorThisStep: boolean;
};

type AuditorPassResult = {
  done: boolean;
  failed: AuditSummary["failed"];
  passed: string[];
  parseError: string | null;
  report: AuditorReportSnapshot;
};

function normalizeRequirementIds(ids: string[]): string[] {
  return Array.from(
    new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
}

function loadAcceptanceRequirementIds(stateDir: string): string[] {
  const acceptanceIndexPath = path.join(stateDir, "acceptance-index.json");
  if (!fs.existsSync(acceptanceIndexPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(acceptanceIndexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      requirements?: { id?: unknown }[];
    };
    if (!Array.isArray(parsed.requirements)) {
      return [];
    }
    return normalizeRequirementIds(
      parsed.requirements
        .map((requirement) =>
          typeof requirement?.id === "string" ? requirement.id : "",
        )
        .filter((id) => id.length > 0),
    );
  } catch {
    return [];
  }
}

function buildAuditorReport(
  step: number,
  auditMode: AuditMode,
  scopeRequirementIds: string[],
  done: boolean,
  failed: AuditSummary["failed"],
  passed: string[],
): AuditorReportSnapshot {
  return {
    cycle: step,
    audit_mode: auditMode,
    scope_requirement_ids: normalizeRequirementIds(scopeRequirementIds),
    done,
    requirements: failed
      .map<AuditorRequirementSnapshot>((requirement) => ({
        id: requirement.id,
        passed: false,
        reason: requirement.reason,
        failure_kind: requirement.failure_kind,
        evidence_gaps: requirement.evidence_gaps,
      }))
      .concat(
        passed.map<AuditorRequirementSnapshot>((id) => ({
          id,
          passed: true,
        })),
      ),
  };
}

async function cleanupAuditorSession(
  sessionId: string | null,
  auditTitle: string,
): Promise<void> {
  let resolvedSessionId = sessionId;
  if (!resolvedSessionId) {
    try {
      resolvedSessionId = await findSessionIdByTitle(auditTitle);
    } catch {
      resolvedSessionId = null;
    }
  }

  if (!resolvedSessionId) {
    return;
  }

  try {
    await runOpencode(
      ["session", "delete", resolvedSessionId],
      undefined,
      false,
    );
  } catch {
    // Cleanup failure is non-fatal.
  }
}

async function runAuditorPass(
  opts: LoopOptions,
  step: number,
  fileArgs: string[],
  auditRaw: string,
  auditMode: AuditMode,
  scopeRequirementIds: string[],
): Promise<AuditorPassResult> {
  const normalizedScopeRequirementIds =
    normalizeRequirementIds(scopeRequirementIds);
  const auditPromptBase = buildAuditPrompt(
    opts.prompt,
    opts.task,
    auditMode,
    normalizedScopeRequirementIds,
  );
  const auditPrompt = withTaskKeyHint(auditPromptBase, opts.task);
  const auditTitle =
    `orchestrator-audit ${opts.task} step=${step} mode=${auditMode} ` +
    `${new Date().toISOString()}`;
  const maxAuditAttempts = Math.max(1, opts.maxRestarts);

  let summary: AuditSummary = {
    done: false,
    requirementsJson: null,
    failed: [],
    passed: [],
    parseError: null,
  };
  let auditorSessionId: string | null = null;
  let attemptsInCurrentSession = 0;

  for (let attempt = 1; attempt <= maxAuditAttempts; attempt += 1) {
    const canReuseSession =
      auditorSessionId !== null &&
      attemptsInCurrentSession > 0 &&
      attemptsInCurrentSession < 3;
    const useExistingSession = canReuseSession;
    const args: string[] = useExistingSession
      ? [
          "run",
          "--session",
          auditorSessionId as string,
          ...fileArgs,
          "--",
          auditPrompt,
        ]
      : [
          "run",
          "--command",
          "orch-audit",
          "--title",
          auditTitle,
          "--format",
          "json",
          ...fileArgs,
          "--",
          auditPrompt,
        ];

    const auditRes = await runOpencode(args, auditRaw, false);
    const auditInfraError = detectExecutorOpencodeInfraError(
      auditRes.stdout,
      auditRes.stderr,
      auditRes.code,
    );
    if (auditInfraError) {
      console.error(
        `[opencode-orchestrator] auditor 実行中に OpenCode 実行エラーが発生しました: ${auditInfraError.message}`,
      );
    }

    const auditSafety = auditRes.stdout.includes(
      "I'm sorry, but I cannot assist with that request.",
    );
    summary = parseAuditResult(auditRes.stdout);

    if (useExistingSession) {
      attemptsInCurrentSession += 1;
    } else {
      attemptsInCurrentSession = 1;
    }

    const shouldRetry =
      attempt < maxAuditAttempts && (auditSafety || !!summary.parseError);

    if (shouldRetry && !useExistingSession) {
      try {
        auditorSessionId = await findSessionIdByTitle(auditTitle);
      } catch {
        auditorSessionId = null;
      }
    }

    if (!shouldRetry) {
      if (auditSafety) {
        console.error(
          "[opencode-orchestrator] auditor の出力で safety trip を検出しました。この監査パスは done=false として扱います。",
        );
      }
      break;
    }

    console.error(
      `[opencode-orchestrator] auditor の出力が契約どおりではありませんでした (attempt=${attempt}/${maxAuditAttempts - 1})。この監査パス内で再試行します。`,
    );
  }

  const effectiveScopeRequirementIds =
    summary.scopeRequirementIds && summary.scopeRequirementIds.length > 0
      ? normalizeRequirementIds(summary.scopeRequirementIds)
      : normalizedScopeRequirementIds;
  const done = auditMode === "final_full" ? summary.done : false;
  const report = buildAuditorReport(
    step,
    auditMode,
    effectiveScopeRequirementIds,
    done,
    summary.failed,
    summary.passed,
  );

  await cleanupAuditorSession(auditorSessionId, auditTitle);

  return {
    done,
    failed: summary.failed,
    passed: summary.passed,
    parseError: summary.parseError ?? null,
    report,
  };
}

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
  // Todo-Writer 用の opencode run 子プロセスにも、危険モード時は
  // command-policy スキップ用のフラグのみを渡す。bwrap サンドボックスは
  // Executor 専用とし、Todo-Writer 側では使用しない。
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
      // このステップでは Executor/Auditor フェーズをスキップし、
      // 次のループステップで同じセッションのまま Todo-Writer を再実行する。
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep: true,
        restartedSession: false,
        abortLoop: false,
        skipExecutorThisStep: true,
      };
    }

    // 同一セッション内での OpenCode 実行エラーが一定回数を超えたため、
    // Todo-Writer セッションごと再起動する。全体の MAX_RESTARTS も尊重する。
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

    // 新しいセッションでは OpenCode エラーカウンタをリセットする。
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
        // For audit_failure proposals, require a meaningful change to todos
        // linked to the failed requirements before auto-resolving.
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
        // For other auto-resolvable proposals (need_replan, verification_gap,
        // contract_gap, etc.), we still require that todo.json has changed
        // structurally in this pass.
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
  // Decide whether to attach status.json to the executor for this step.
  // We only do this for the cycle immediately following an auditor run
  // (status.last_auditor_report.cycle + 1 === current step) and only when
  // that auditor run did not already declare the story done.
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
  // Executor 用の opencode run 子プロセスにのみ、サンドボックス関連の
  // フラグを環境変数として渡す。ループ本体の process.env は変更しない。
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

  // Detect low-level OpenCode runtime errors that prevent the Executor
  // contract from even starting (for example plugin load failures or
  // transient request-format errors around reasoning items). These are
  // distinct from model-level safety trips and are handled with a
  // "retry within the same session up to 3 times, then restart session"
  // policy.
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

    // Guardrail: do not exceed the global MAX_RESTARTS budget.
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

    // Reset OpenCode error budget for the fresh session.
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
    // Track consecutive safety trips within the same session so that we can
    // decide when to give up on a "poisoned" session and restart it. The
    // user has observed that explicitly telling the same session to
    // "continue" sometimes clears a false-positive safety trigger, so we
    // allow a few retries before restarting.
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
    // First, enforce the overall MAX_RESTARTS guardrail.
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

    // If the same opencode session has tripped the safety filter multiple
    // times in a row, assume this session is effectively poisoned and restart
    // from a fresh todo-writer session. Otherwise, keep the current session
    // and let the next executor step try to continue within it.
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
      // 次のセッションではカウンタをリセットする。
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

  const stepSnapshot: ExecutorStepSnapshot = parseExecutorStepSnapshot(
    execRes.stdout,
    sessionId,
    step,
  );
  status.last_executor_step = stepSnapshot;
  let needReplanProposal: ProposalEntry | null = null;
  let contractGapProposal: ProposalEntry | null = null;

  if (!stepSnapshot.step_intent || !stepSnapshot.step_verify) {
    failureBudget.consecutive_contract_gaps += 1;
    failureBudget.last_failure_kind = "executor_contract_gap";
    failureBudget.last_failure_summary =
      "executor が必須の STEP_INTENT / STEP_VERIFY 行を出力しなかった";
    if (failureBudget.consecutive_contract_gaps >= 2) {
      forceTodoWriterNextStep = true;
      contractGapProposal = createProposalEntry({
        source: "executor",
        cycle: step,
        kind: "contract_gap",
        priority: "medium",
        summary:
          "executor の step 出力契約が連続で不足しているため、todo と検証境界を再計画したい",
        details:
          "executor の出力が不足している。各 step で STEP_INTENT と STEP_VERIFY を必ず出力できるように todo と検証境界を明確にしたい",
        related_requirement_ids:
          stepSnapshot.step_audit?.requirement_ids ??
          stepSnapshot.step_intent?.requirement_ids ??
          [],
        related_todo_ids: [],
        auto_resolvable: true,
      });
    }
  } else {
    failureBudget.consecutive_contract_gaps = 0;
  }
  const otherBlockers = stepSnapshot.step_blocker.filter(
    (b) => b.tag && b.tag !== "need_replan",
  );

  const proposalsPath = path.join(path.dirname(statusPath), "proposals.json");
  const stepProposalFile = loadProposals(proposalsPath);
  let stepProposalChanged = false;

  for (const blocker of otherBlockers) {
    if (blocker.tag !== "scope_change" && blocker.tag !== "priority_shift") {
      continue;
    }
    stepProposalFile.proposals.push(
      createProposalEntry({
        source: "executor",
        cycle: step,
        kind: blocker.tag,
        priority: blocker.tag === "priority_shift" ? "low" : "medium",
        summary: blocker.reason,
        details: `${blocker.scope}: ${blocker.tag}: ${blocker.reason}`,
        related_requirement_ids:
          stepSnapshot.step_audit?.requirement_ids ??
          stepSnapshot.step_intent?.requirement_ids ??
          [],
        related_todo_ids: blocker.scope !== "general" ? [blocker.scope] : [],
        auto_resolvable: true,
      }),
    );
    stepProposalChanged = true;
    forceTodoWriterNextStep = true;
  }

  for (const line of execRes.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("STEP_BLOCKER:")) continue;
    const rest = trimmed.slice("STEP_BLOCKER:".length).trim();
    if (!rest) continue;
    const firstSpace = rest.indexOf(" ");
    if (firstSpace === -1) continue;
    const scope = rest.slice(0, firstSpace).trim();
    const restAfterScope = rest.slice(firstSpace + 1).trim();
    const secondSpace = restAfterScope.indexOf(" ");
    if (secondSpace === -1) continue;
    const tag = restAfterScope.slice(0, secondSpace).trim();
    if (tag === "need_replan") {
      forceTodoWriterNextStep = true;
      needReplanProposal = createProposalEntry({
        source: "executor",
        cycle: step,
        kind: "need_replan",
        priority: "high",
        summary: restAfterScope.slice(secondSpace + 1).trim(),
        details: `${scope}: ${tag}: ${restAfterScope.slice(secondSpace + 1).trim()}`,
        related_requirement_ids:
          stepSnapshot.step_audit?.requirement_ids ??
          stepSnapshot.step_intent?.requirement_ids ??
          [],
        related_todo_ids: scope !== "general" ? [scope] : [],
        auto_resolvable: true,
      });
      console.error(
        `[opencode-orchestrator] executor から ${scope} need_replan の STEP_BLOCKER が出力されたため、次のステップで todo-writer を強制実行します。`,
      );
      break;
    }
  }

  let shouldAudit = false;
  let auditParseError: string | null = null;
  let lastAuditStatus: string | null = null;
  let lastAuditIds: string | null = null;
  let verificationGapProposal: ProposalEntry | null = null;
  for (const line of execRes.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("STEP_AUDIT:")) continue;
    const rest = trimmed.slice("STEP_AUDIT:".length).trim();
    if (!rest) continue;
    const firstSpace = rest.indexOf(" ");
    if (firstSpace === -1) continue;
    const statusVal = rest.slice(0, firstSpace).trim();
    const ids = rest.slice(firstSpace + 1).trim();
    lastAuditStatus = statusVal;
    lastAuditIds = ids || null;
  }

  if (lastAuditStatus === "ready") {
    const verificationEvidence = getExecutorVerificationEvidence(stepSnapshot);
    const stateDir = path.dirname(statusPath);
    const hasPersistedEvidence = hasPersistedVerificationEvidence(stateDir);
    if (
      stepSnapshot.step_verify?.status === "ready" &&
      (verificationEvidence.hasEvidence || hasPersistedEvidence)
    ) {
      failureBudget.consecutive_verification_gaps = 0;
      shouldAudit = true;
      if (lastAuditIds && lastAuditIds !== "-") {
        console.error(
          `[opencode-orchestrator] executor が監査対象として報告した要件 ID: ${lastAuditIds}`,
        );
      } else {
        console.error(
          "[opencode-orchestrator] executor が監査準備完了を報告しました (特定の要件 ID は指定されていません)。",
        );
      }
    } else {
      failureBudget.consecutive_verification_gaps += 1;
      failureBudget.last_failure_kind = "verification_gap";
      failureBudget.last_failure_summary =
        "STEP_AUDIT: ready が出たが STEP_VERIFY の根拠が不足している";
      const evidenceHint =
        verificationEvidence.reason === "missing"
          ? "command id・差分確認・no-command 理由のいずれかを明示したい"
          : `verification evidence=${verificationEvidence.reason}`;
      console.error(
        "[opencode-orchestrator] STEP_VERIFY の根拠が不足したまま STEP_AUDIT: ready が出力されたため、このステップでは auditor をスキップします。",
      );
      if (failureBudget.consecutive_verification_gaps >= 2) {
        forceTodoWriterNextStep = true;
        verificationGapProposal = createProposalEntry({
          source: "executor",
          cycle: step,
          kind: "verification_gap",
          priority: "medium",
          summary:
            "監査準備の自己検証が連続で不足しているため、todo の証拠境界を再計画したい",
          details: `監査準備を宣言したが自己検証の根拠が不足している。STEP_VERIFY に command id・差分確認・no-command 理由を結び付け、必要なら todo を監査証拠単位で再分解したい (${evidenceHint})`,
          related_requirement_ids:
            lastAuditIds && lastAuditIds !== "-"
              ? lastAuditIds
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0)
              : [],
          related_todo_ids: [],
          auto_resolvable: true,
        });
      }
    }
  } else {
    failureBudget.consecutive_verification_gaps = 0;
  }

  const envBlockedBlockers = otherBlockers.filter(
    (b) => b.tag === "env_blocked",
  );
  const envBlockedReasonFromExecutor = envBlockedBlockers[0]?.reason;
  const envBlockedReason =
    auditParseError ?? envBlockedReasonFromExecutor ?? undefined;
  if (envBlockedReason) {
    const prevEnvBlocked = status.consecutive_env_blocked ?? 0;
    status.consecutive_env_blocked = prevEnvBlocked + 1;
    failureBudget.consecutive_env_blocked = status.consecutive_env_blocked;
    failureBudget.last_failure_kind = "env_blocked";
    failureBudget.last_failure_summary = envBlockedReason;
    if (status.consecutive_env_blocked >= 3) {
      const proposalsPath = path.join(
        path.dirname(statusPath),
        "proposals.json",
      );
      const proposalsFile = loadProposals(proposalsPath);
      if (envBlockedBlockers.length > 0) {
        for (const blocker of envBlockedBlockers) {
          proposalsFile.proposals.push(
            createProposalEntry({
              source: "executor",
              cycle: step,
              kind: "env_blocked",
              priority: "critical",
              summary:
                "環境依存のエラー (env_blocked) が 3 回連続で発生し、Executor ループを継続できません。必須コマンドや command-policy の前提を見直してほしい。",
              details: `${blocker.scope}: ${blocker.tag}: ${blocker.reason}`,
              related_requirement_ids:
                stepSnapshot.step_audit?.requirement_ids ??
                stepSnapshot.step_intent?.requirement_ids ??
                [],
              related_todo_ids:
                blocker.scope !== "general" ? [blocker.scope] : [],
              auto_resolvable: false,
            }),
          );
        }
      } else {
        proposalsFile.proposals.push(
          createProposalEntry({
            source: "auditor",
            cycle: step,
            kind: "env_blocked",
            priority: "critical",
            summary:
              "監査結果の解析に繰り返し失敗し、環境状態を正しく判定できません。acceptance-index/spec.md と command-policy を見直してほしい。",
            details: envBlockedReason,
            related_requirement_ids:
              stepSnapshot.step_audit?.requirement_ids ??
              stepSnapshot.step_intent?.requirement_ids ??
              [],
            related_todo_ids: [],
            auto_resolvable: false,
          }),
        );
      }
      saveProposals(proposalsPath, proposalsFile);
    }
  } else {
    status.consecutive_env_blocked = 0;
    failureBudget.consecutive_env_blocked = 0;
  }

  let stepDone = false;
  if (shouldAudit) {
    const stateDir = path.dirname(statusPath);
    const fullRequirementIds = loadAcceptanceRequirementIds(stateDir);
    const incrementalScopeIds = normalizeRequirementIds(
      (stepSnapshot.step_audit?.requirement_ids?.length ?? 0) > 0
        ? (stepSnapshot.step_audit?.requirement_ids ?? [])
        : (stepSnapshot.step_intent?.requirement_ids ?? []),
    );
    const effectiveIncrementalScopeIds =
      incrementalScopeIds.length > 0 ? incrementalScopeIds : fullRequirementIds;

    if (incrementalScopeIds.length === 0 && fullRequirementIds.length > 0) {
      console.error(
        `[opencode-orchestrator] executor が監査対象 ID を明示しなかったため、incremental audit は full acceptance set にフォールバックします: ${fullRequirementIds.join(", ")}`,
      );
    }

    let activeAudit = await runAuditorPass(
      opts,
      step,
      fileArgs,
      auditRaw,
      "incremental",
      effectiveIncrementalScopeIds,
    );

    const incrementalPassedAllScopedRequirements =
      !activeAudit.parseError && activeAudit.failed.length === 0;

    if (incrementalPassedAllScopedRequirements) {
      console.error(
        "[opencode-orchestrator] incremental audit passed for the executor-declared scope. Running final full audit before authorizing loop completion.",
      );
      activeAudit = await runAuditorPass(
        opts,
        step,
        fileArgs,
        auditRaw,
        "final_full",
        fullRequirementIds,
      );
    }

    auditParseError = activeAudit.parseError;
    stepDone = activeAudit.done;
    if (activeAudit.parseError) {
      console.error(
        `[opencode-orchestrator] auditor の出力をパースできませんでした: ${activeAudit.parseError}`,
      );
    }
    if (activeAudit.done) {
      failureBudget.consecutive_audit_failures = 0;
    } else {
      failureBudget.consecutive_audit_failures += 1;
      failureBudget.last_failure_kind = "audit_failed";
      failureBudget.last_failure_summary =
        activeAudit.failed[0]?.reason || "auditor が未達要件を報告した";
    }
    console.error(`[opencode-orchestrator] auditor done = ${stepDone}`);

    status.last_auditor_report = activeAudit.report;

    if (activeAudit.failed.length > 0) {
      const ids = activeAudit.failed.map((f) => f.id).join(", ");
      console.error(
        `[opencode-orchestrator] auditor が未達と判定した要件: ${ids}`,
      );
      const proposalsPath = path.join(
        path.dirname(statusPath),
        "proposals.json",
      );
      const proposalsFile = loadProposals(proposalsPath);
      for (const f of activeAudit.failed) {
        if (!f.reason) continue;
        const firstLine = String(f.reason).split(/\r?\n/, 1)[0];
        console.error(`[opencode-orchestrator]   - ${f.id}: ${firstLine}`);
        const detailsParts: string[] = [f.reason];
        if (f.failure_kind) {
          detailsParts.push(`[failure_kind: ${f.failure_kind}]`);
        }
        if (f.evidence_gaps && f.evidence_gaps.length > 0) {
          detailsParts.push(`Evidence gaps: ${f.evidence_gaps.join("; ")}`);
        }
        proposalsFile.proposals.push(
          createProposalEntry({
            source: "auditor",
            cycle: step,
            kind: "audit_failure",
            priority: "high",
            summary: firstLine,
            details: detailsParts.join("\n"),
            related_requirement_ids: [f.id],
            related_todo_ids: [],
            auto_resolvable: true,
          }),
        );
      }
      saveProposals(proposalsPath, proposalsFile);
      forceTodoWriterNextStep = true;
    }

    if (activeAudit.passed.length > 0) {
      console.error(
        `[opencode-orchestrator] auditor が達成済みと判定した要件: ${activeAudit.passed.join(", ")}`,
      );
    }
  } else if (lastAuditStatus === "ready") {
    // ready だが shouldAudit=false ということは、STEP_VERIFY 側の
    // 根拠不足などで監査を走らせないパス。すでに上の分岐で
    // verification_gap のメッセージは出しているが、ここでも
    // 「ready だが証拠不足のため auditor を起動しない」と補足する。
    console.error(
      "[opencode-orchestrator] STEP_AUDIT: ready だが STEP_VERIFY の証拠不足のため、このステップでは auditor を起動しません。",
    );
  } else {
    // STEP_AUDIT: ready が 1 度も報告されていない場合にだけ、
    // 「ready が出ていない」というメッセージを出す。
    console.error(
      "[opencode-orchestrator] このステップでは executor から STEP_AUDIT: ready が出ていないため、auditor は起動しません。",
    );
  }

  saveStatusJson(statusPath, status);

  if (needReplanProposal) {
    stepProposalFile.proposals.push(needReplanProposal);
  }
  if (contractGapProposal) {
    stepProposalFile.proposals.push(contractGapProposal);
  }
  if (verificationGapProposal) {
    stepProposalFile.proposals.push(verificationGapProposal);
  }
  if (needReplanProposal || contractGapProposal || verificationGapProposal) {
    stepProposalChanged = true;
  }
  if (stepProposalChanged) {
    saveProposals(proposalsPath, stepProposalFile);
  }
  const currentProposalsFile = loadProposals(proposalsPath);
  if (hasOpenNonAutoResolvableProposals(currentProposalsFile)) {
    console.error(
      "[opencode-orchestrator] proposals.json に未解決の非自動解決 proposal が存在するため、ループを停止します。",
    );
    console.error(
      "[opencode-orchestrator] このループ実行中に記録された proposal:",
    );
    for (const p of currentProposalsFile.proposals.filter(
      (proposal) => proposal.status === "open",
    )) {
      console.error(
        `  - [${p.source}] kind=${p.kind} cycle=${p.cycle} id=${p.id}`,
      );
      console.error(`    summary: ${p.summary}`);
      if (p.details) {
        const firstLine = String(p.details).split(/\r?\n/, 1)[0];
        console.error(`    details: ${firstLine}`);
      }
    }
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep,
      done: stepDone,
      abortLoop: true,
      skipAuditorThisStep: false,
    };
  }

  return {
    sessionId,
    restartCount,
    forceTodoWriterNextStep,
    done: stepDone,
    abortLoop: false,
    skipAuditorThisStep: false,
  };
}

function ensureFailureBudget(
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
    };
  }
  return status.failure_budget;
}

type TodoSummary =
  | {
      ok: true;
      total: number;
      pending: number;
      inProgress: number;
      completed: number;
      cancelled: number;
    }
  | {
      ok: false;
      reason: string;
    };

function readTodoSummary(todoPath: string): TodoSummary {
  if (!fs.existsSync(todoPath)) {
    return { ok: false, reason: "todo.json missing" };
  }

  try {
    const todoRaw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(todoRaw) as { todos?: unknown } | unknown[];
    const todos = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;
    if (!todos || !todos.every(isCanonicalTodoLike)) {
      return { ok: false, reason: "todo.json has invalid shape" };
    }
    return {
      ok: true,
      total: todos.length,
      pending: todos.filter(
        (t) => t && (t as { status?: string }).status === "pending",
      ).length,
      inProgress: todos.filter(
        (t) => t && (t as { status?: string }).status === "in_progress",
      ).length,
      completed: todos.filter(
        (t) => t && (t as { status?: string }).status === "completed",
      ).length,
      cancelled: todos.filter(
        (t) => t && (t as { status?: string }).status === "cancelled",
      ).length,
    };
  } catch {
    return { ok: false, reason: "todo.json parse failed" };
  }
}

type CoverageCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

function validateTodoCoverage(
  acceptanceIndexPath: string,
  status: OrchestratorStatus,
  todoPath: string,
): CoverageCheckResult {
  if (!fs.existsSync(acceptanceIndexPath)) {
    // When there is no acceptance index yet, we cannot enforce coverage.
    return { ok: true };
  }

  if (!fs.existsSync(todoPath)) {
    return { ok: false, reason: "todo.json missing" };
  }

  // Load requirement ids from acceptance-index.json.
  let requirementIds: string[] = [];
  try {
    const raw = fs.readFileSync(acceptanceIndexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      requirements?: { id?: unknown }[];
    };
    if (Array.isArray(parsed.requirements)) {
      requirementIds = parsed.requirements
        .map((req) =>
          req && typeof req.id === "string" ? (req.id as string) : null,
        )
        .filter((id): id is string => id !== null);
    }
  } catch {
    // If the acceptance index is unreadable, skip strict coverage enforcement.
    return { ok: true };
  }

  if (requirementIds.length === 0) {
    return { ok: true };
  }

  // Determine which requirements are still unsatisfied.
  const report = status.last_auditor_report;
  let unsatisfiedIds: string[];
  if (!report || !Array.isArray(report.requirements)) {
    unsatisfiedIds = requirementIds;
  } else {
    const passedMap = new Map<string, boolean>();
    for (const r of report.requirements) {
      if (r && typeof r.id === "string") {
        passedMap.set(r.id, !!r.passed);
      }
    }
    unsatisfiedIds = requirementIds.filter((id) => passedMap.get(id) !== true);
  }

  if (unsatisfiedIds.length === 0) {
    return { ok: true };
  }

  // Load todos and check for active coverage over unsatisfied requirements.
  try {
    const todoRaw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(todoRaw) as { todos?: unknown } | unknown[];
    const todosUnknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;

    if (!todosUnknown || !todosUnknown.every(isCanonicalTodoLike)) {
      return { ok: false, reason: "todo.json has invalid shape" };
    }

    type TodoLike = {
      status: string;
      related_requirement_ids: string[];
    };

    const todos = todosUnknown as TodoLike[];
    const activeStatuses = new Set<string>(["pending", "in_progress"]);
    const missingActive: string[] = [];

    for (const reqId of unsatisfiedIds) {
      const hasActive = todos.some(
        (t) =>
          activeStatuses.has(t.status) &&
          Array.isArray(t.related_requirement_ids) &&
          t.related_requirement_ids.includes(reqId),
      );
      if (!hasActive) {
        missingActive.push(reqId);
      }
    }

    if (missingActive.length > 0) {
      return {
        ok: false,
        reason:
          "coverage invariant violated for requirements without active todos: " +
          missingActive.join(", "),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "todo.json parse failed" };
  }
}

function normalizeTodoFile(todoPath: string): string | null {
  if (!fs.existsSync(todoPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(raw) as { todos?: unknown } | unknown[];
    const todos = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;
    if (!todos) {
      return null;
    }
    return JSON.stringify(todos);
  } catch {
    return null;
  }
}

type MinimalTodo = {
  id: string;
  status: string;
  related_requirement_ids: string[];
  intent?: string;
  expected_evidence?: string[];
  audit_ready_when?: string[];
};

function loadMinimalTodos(todoPath: string): MinimalTodo[] | null {
  if (!fs.existsSync(todoPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(raw) as { todos?: unknown } | unknown[];
    const todosUnknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;
    if (!todosUnknown || !todosUnknown.every(isCanonicalTodoLike)) {
      return null;
    }

    type TodoLike = {
      id: string;
      status: string;
      related_requirement_ids: string[];
      execution_contract?: {
        intent?: string;
        expected_evidence?: string[];
        audit_ready_when?: string[];
      };
    };

    const todos = todosUnknown as TodoLike[];
    return todos.map<MinimalTodo>((t) => ({
      id: t.id,
      status: t.status,
      related_requirement_ids: Array.isArray(t.related_requirement_ids)
        ? t.related_requirement_ids
        : [],
      intent: t.execution_contract?.intent,
      expected_evidence: t.execution_contract?.expected_evidence,
      audit_ready_when: t.execution_contract?.audit_ready_when,
    }));
  } catch {
    return null;
  }
}

function hasMeaningfulTodoChangeForRequirement(
  requirementId: string,
  prevTodos: MinimalTodo[] | null,
  nextTodos: MinimalTodo[] | null,
): boolean {
  const prev = prevTodos ?? [];
  const next = nextTodos ?? [];

  const prevForReq = prev.filter((t) =>
    Array.isArray(t.related_requirement_ids)
      ? t.related_requirement_ids.includes(requirementId)
      : false,
  );
  const nextForReq = next.filter((t) =>
    Array.isArray(t.related_requirement_ids)
      ? t.related_requirement_ids.includes(requirementId)
      : false,
  );

  if (nextForReq.length === 0) {
    // No active coverage for this requirement in the new todo set.
    return false;
  }

  const prevIds = new Set(prevForReq.map((t) => t.id));
  const hasNewTodo = nextForReq.some((t) => !prevIds.has(t.id));
  if (hasNewTodo) {
    return true;
  }

  // Compare per-todo contract-level changes.
  for (const nextTodo of nextForReq) {
    const prevTodo = prevForReq.find((t) => t.id === nextTodo.id);
    if (!prevTodo) {
      continue;
    }

    // Intent change.
    if (prevTodo.intent !== nextTodo.intent) {
      return true;
    }

    const prevEE = prevTodo.expected_evidence ?? [];
    const nextEE = nextTodo.expected_evidence ?? [];
    if (nextEE.length > prevEE.length) {
      return true;
    }

    const prevARW = prevTodo.audit_ready_when ?? [];
    const nextARW = nextTodo.audit_ready_when ?? [];
    if (nextARW.length > prevARW.length) {
      return true;
    }
  }

  return false;
}

function hasPersistedVerificationEvidence(stateDir: string): boolean {
  const todoPath = path.join(stateDir, "todo.json");
  if (!fs.existsSync(todoPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(raw) as { todos?: unknown } | unknown[];
    const todosUnknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;

    if (!todosUnknown) {
      return false;
    }

    for (const value of todosUnknown) {
      if (!value || typeof value !== "object") continue;
      const todo = value as {
        status?: unknown;
        result_artifacts?: unknown;
      };

      if (todo.status !== "completed") {
        continue;
      }

      if (!Array.isArray(todo.result_artifacts)) {
        continue;
      }

      const hasValidArtifact = todo.result_artifacts.some((artifact) => {
        if (!artifact || typeof artifact !== "object") return false;
        const obj = artifact as {
          kind?: unknown;
          path?: unknown;
          summary?: unknown;
        };
        return (
          typeof obj.kind === "string" &&
          typeof obj.path === "string" &&
          typeof obj.summary === "string"
        );
      });

      if (hasValidArtifact) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function isCanonicalTodoLike(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const todo = value as {
    id?: unknown;
    summary?: unknown;
    status?: unknown;
    related_requirement_ids?: unknown;
  };
  return (
    typeof todo.id === "string" &&
    typeof todo.summary === "string" &&
    (todo.status === "pending" ||
      todo.status === "in_progress" ||
      todo.status === "completed" ||
      todo.status === "cancelled") &&
    Array.isArray(todo.related_requirement_ids) &&
    todo.related_requirement_ids.every((rid) => typeof rid === "string")
  );
}

type ExecutorOpencodeInfraErrorKind =
  | "unexpected_error"
  | "reasoning_item_missing";

type ExecutorOpencodeInfraError = {
  kind: ExecutorOpencodeInfraErrorKind;
  message: string;
};

function detectExecutorOpencodeInfraError(
  stdout: string,
  stderr?: string,
  code?: number | null,
): ExecutorOpencodeInfraError | null {
  const combinedRaw = `${stdout ?? ""}\n${stderr ?? ""}`;
  // Strip common ANSI color codes so that we can reliably search for error
  // phrases even when the terminal renders "Error:" in red, etc.
  const combined = combinedRaw.replace(/\u001b\[[0-9;]*m/g, "");

  // 1) Keep explicit pattern matching for known opencode CLI failures.
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

  // Reasoning item format error. The exact type name ("reasoning") or spacing
  // around it may change, and the message may be broken across multiple lines.
  // For robustness, we only require that the generic phrase structure matches.
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

  // 2) Generic fallback: treat any non-zero exit code with an "Error:" line
  // as an opencode infrastructure error. This intentionally does NOT match
  // session-level errors that only surface as JSON events (which currently
  // leave the CLI exit code as 0).
  const hasNonZeroExit = typeof code === "number" ? code !== 0 : code == null;
  if (hasNonZeroExit && combined.includes("Error:")) {
    const line = combined.split(/\r?\n/).find((l) => l.includes("Error:"));
    return {
      // Map generic infra failures onto the existing "unexpected_error" kind
      // so that existing summary / i18n keys continue to apply.
      kind: "unexpected_error",
      message: (line || "Error: <unknown opencode CLI error>").trim(),
    };
  }

  return null;
}

async function restartFromSafety(
  context: "todo-writer" | "executor",
  opts: LoopOptions,
  logDir: string,
  fileArgsForRestart: string[],
  sessionId: string,
  status: OrchestratorStatus,
  statusPath: string,
  restartCount: number,
): Promise<string> {
  const safeExport = path.join(
    logDir,
    `orchestrator_session_${Date.now().toString()}_restart${restartCount}_old.json`,
  );
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
