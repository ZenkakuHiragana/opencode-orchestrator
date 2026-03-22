import * as fs from "node:fs";
import * as path from "node:path";

import type { LoopOptions } from "./cli-args.js";
import { runOpencode } from "./orchestrator-process.js";
import {
  buildAuditPrompt,
  buildExecutorPrompt,
  buildTodoWriterPrompt,
} from "./orchestrator-prompts.js";
import { parseAuditResult } from "./orchestrator-audit.js";
import type {
  AuditorRequirementSnapshot,
  FailureBudgetSnapshot,
  AuditorReportSnapshot,
  ExecutorStepSnapshot,
  OrchestratorStatus,
  ReplanIssue,
} from "./orchestrator-status.js";
import {
  buildReplanRequest,
  parseExecutorStepSnapshot,
  saveStatusJson,
  ProposalSnapshot,
} from "./orchestrator-status.js";
import {
  appendFileArg,
  findSessionIdByTitle,
  restartSession,
} from "./orchestrator-session.js";

export type TodoWriterStepResult = {
  sessionId: string;
  restartCount: number;
  forceTodoWriterNextStep: boolean;
  restartedSession: boolean;
  abortLoop: boolean;
};

export type ExecutorAuditorStepResult = {
  sessionId: string;
  restartCount: number;
  forceTodoWriterNextStep: boolean;
  done: boolean;
  abortLoop: boolean;
  skipAuditorThisStep: boolean;
};

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
  const needReplan = status.replan_required === true || forceTodoWriterNextStep;
  if (!fs.existsSync(acceptanceIndexPath) || (step !== 1 && !needReplan)) {
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep,
      restartedSession: false,
      abortLoop: false,
    };
  }

  const todowriterLog = path.join(logDir, `todowriter_step_${stepId}.txt`);
  const todowriterPrompt = buildTodoWriterPrompt(status);
  const planRes = await runOpencode(
    [
      "run",
      "--command",
      "orch-todo-write",
      "--session",
      sessionId,
      ...appendFileArg(fileArgs, statusPath),
      "--",
      todowriterPrompt,
    ],
    todowriterLog,
  );

  const todowriterSafety = planRes.stdout.includes(
    "I'm sorry, but I can't assist with that request.",
  );
  if (todowriterSafety) {
    failureBudget.todo_writer_safety_restarts += 1;
    failureBudget.last_failure_kind = "todo_writer_safety";
    failureBudget.last_failure_summary =
      "todo-writer が safety trip を起こしたためセッションを再開した";
    saveStatusJson(statusPath, status);
    console.error(
      "[opencode-orchestrator] SAFETY trip detected in todo-writer output; restarting session.",
    );
    if (restartCount >= opts.maxRestarts) {
      console.error(
        `[opencode-orchestrator] MAX_RESTARTS=${opts.maxRestarts} reached during todo-writer; aborting.`,
      );
      return {
        sessionId,
        restartCount,
        forceTodoWriterNextStep,
        restartedSession: false,
        abortLoop: true,
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
    };
  }

  if (planRes.code !== 0) {
    failureBudget.last_failure_kind = "todo_writer_failed";
    failureBudget.last_failure_summary =
      "todo-writer が non-zero exit を返したため再計画状態を維持する";
    status.replan_required = true;
    status.replan_reason =
      status.replan_reason ??
      "general: todo-writer が失敗したため既存の再計画要求を維持したい";
    saveStatusJson(statusPath, status);
    console.error(
      "[opencode-orchestrator] todo-writer step exited with non-zero status",
    );
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep: true,
      restartedSession: false,
      abortLoop: false,
    };
  }

  const todoPath = path.join(stateDir, "todo.json");
  const todoSummary = readTodoSummary(todoPath);
  if (!todoSummary.ok) {
    failureBudget.last_failure_kind = "todo_writer_invalid_todo_cache";
    failureBudget.last_failure_summary =
      "todo-writer が有効な todo.json を残さなかったため再計画状態を維持する";
    status.replan_required = true;
    status.replan_reason =
      status.replan_reason ??
      "general: todo-writer が有効な todo.json を生成できなかったため再計画を継続したい";
    saveStatusJson(statusPath, status);
    console.error(
      `[opencode-orchestrator] todo-writer todos: invalid (${todoSummary.reason})`,
    );
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep: true,
      restartedSession: false,
      abortLoop: false,
    };
  }

  console.error(
    `[opencode-orchestrator] todo-writer todos: total=${todoSummary.total} ` +
      `pending=${todoSummary.pending} in_progress=${todoSummary.inProgress} ` +
      `completed=${todoSummary.completed} cancelled=${todoSummary.cancelled}`,
  );

  status.replan_required = false;
  status.replan_reason = null;
  status.replan_request = null;
  failureBudget.consecutive_contract_gaps = 0;
  failureBudget.consecutive_verification_gaps = 0;
  saveStatusJson(statusPath, status);

  return {
    sessionId,
    restartCount,
    forceTodoWriterNextStep: false,
    restartedSession: false,
    abortLoop: false,
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
    return appendFileArg(fileArgs, statusPath);
  })();

  const execPrompt = buildExecutorPrompt(isNextAfterAudit, status);
  const execRes = await runOpencode(
    [
      "run",
      "--command",
      "orch-exec",
      "--session",
      sessionId,
      ...execFileArgs,
      "--",
      execPrompt,
    ],
    orchLog,
  );

  const safetyTripped = execRes.stdout.includes(
    "I'm sorry, but I can't assist with that request.",
  );
  if (safetyTripped) {
    failureBudget.executor_safety_restarts += 1;
    failureBudget.last_failure_kind = "executor_safety";
    failureBudget.last_failure_summary =
      "executor が safety trip を起こしたためセッションを再開した";
    saveStatusJson(statusPath, status);
    console.error(
      "[opencode-orchestrator] SAFETY trip detected in executor output.",
    );
    if (restartCount >= opts.maxRestarts) {
      console.error(
        `[opencode-orchestrator] MAX_RESTARTS=${opts.maxRestarts} reached; aborting.`,
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
      "[opencode-orchestrator] executor step exited with non-zero status",
    );
  }

  const stepSnapshot: ExecutorStepSnapshot = parseExecutorStepSnapshot(
    execRes.stdout,
    sessionId,
    step,
  );
  status.last_executor_step = stepSnapshot;
  let contractGapIssue: ReplanIssue | null = null;

  if (!stepSnapshot.step_intent || !stepSnapshot.step_verify) {
    failureBudget.consecutive_contract_gaps += 1;
    failureBudget.last_failure_kind = "executor_contract_gap";
    failureBudget.last_failure_summary =
      "executor が必須の STEP_INTENT / STEP_VERIFY 行を出力しなかった";
    contractGapIssue = {
      source: "executor",
      summary:
        "executor の出力が不足している。各 step で STEP_INTENT と STEP_VERIFY を必ず出力できるように todo と検証境界を明確にしたい",
      related_todo_ids: [],
      related_requirement_ids:
        stepSnapshot.step_audit?.requirement_ids ??
        stepSnapshot.step_intent?.requirement_ids ??
        [],
    };
    if (failureBudget.consecutive_contract_gaps >= 2) {
      status.replan_required = true;
      status.replan_reason =
        "general: executor の step 出力契約が連続で不足しているため、todo と検証境界を再計画したい";
      forceTodoWriterNextStep = true;
    }
  } else {
    failureBudget.consecutive_contract_gaps = 0;
  }

  const replanBlocker = stepSnapshot.step_blocker.find(
    (b) => b.tag === "need_replan",
  );
  if (replanBlocker) {
    status.replan_required = true;
    status.replan_reason = `${replanBlocker.scope}: ${replanBlocker.reason}`;
  }
  const otherBlockers = stepSnapshot.step_blocker.filter(
    (b) => b.tag && b.tag !== "need_replan",
  );

  const hasEnvBlocked = otherBlockers.some((b) => b.tag === "env_blocked");
  if (hasEnvBlocked) {
    const prevEnvBlocked = status.consecutive_env_blocked ?? 0;
    status.consecutive_env_blocked = prevEnvBlocked + 1;
    failureBudget.consecutive_env_blocked = status.consecutive_env_blocked;
    failureBudget.last_failure_kind = "env_blocked";
    failureBudget.last_failure_summary =
      otherBlockers.find((b) => b.tag === "env_blocked")?.reason ||
      "executor が env_blocked を報告した";
    if (status.consecutive_env_blocked >= 3) {
      const proposals: ProposalSnapshot[] = Array.isArray(status.proposals)
        ? status.proposals.slice()
        : [];
      const blockersForProposal = otherBlockers.filter(
        (b) => b.tag === "env_blocked",
      );
      for (const blocker of blockersForProposal) {
        proposals.push({
          id: `p-${Date.now()}-${blocker.tag}`,
          source: "executor",
          cycle: step,
          kind: blocker.tag,
          summary: "Executor reported env_blocked in 3 consecutive steps",
          details: `${blocker.scope}: ${blocker.tag}: ${blocker.reason}`,
        });
      }
      status.proposals = proposals;
    }
  } else {
    status.consecutive_env_blocked = 0;
    failureBudget.consecutive_env_blocked = 0;
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
    if (scope === "general" && tag === "need_replan") {
      forceTodoWriterNextStep = true;
      console.error(
        "[opencode-orchestrator] executor requests replanning (general need_replan); forcing todo-writer on next step.",
      );
      break;
    }
  }

  let shouldAudit = false;
  let lastAuditStatus: string | null = null;
  let lastAuditIds: string | null = null;
  let verificationGapIssue: ReplanIssue | null = null;
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
    if (stepSnapshot.step_verify?.status === "ready") {
      failureBudget.consecutive_verification_gaps = 0;
      shouldAudit = true;
      if (lastAuditIds && lastAuditIds !== "-") {
        console.error(
          `[opencode-orchestrator] executor reports audit-ready requirements: ${lastAuditIds}`,
        );
      } else {
        console.error(
          "[opencode-orchestrator] executor reports audit-ready state (no specific requirement ids).",
        );
      }
    } else {
      failureBudget.consecutive_verification_gaps += 1;
      failureBudget.last_failure_kind = "verification_gap";
      failureBudget.last_failure_summary =
        "STEP_AUDIT: ready が出たが STEP_VERIFY: ready が不足している";
      verificationGapIssue = {
        source: "executor",
        summary:
          "監査準備を宣言したが自己検証の根拠が不足している。STEP_VERIFY を明示し、必要なら todo を監査証拠単位で再分解したい",
        related_todo_ids: [],
        related_requirement_ids:
          lastAuditIds && lastAuditIds !== "-"
            ? lastAuditIds
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            : [],
      };
      console.error(
        "[opencode-orchestrator] executor requested audit without STEP_VERIFY: ready; skipping auditor for this step.",
      );
      if (failureBudget.consecutive_verification_gaps >= 2) {
        status.replan_required = true;
        status.replan_reason =
          "general: 監査準備の自己検証が連続で不足しているため、todo の証拠境界を再計画したい";
        forceTodoWriterNextStep = true;
      }
    }
  } else {
    failureBudget.consecutive_verification_gaps = 0;
  }

  let stepDone = false;
  if (shouldAudit) {
    const auditPrompt = buildAuditPrompt(opts.prompt, opts.task);
    const auditTitle = `orchestrator-audit ${opts.task} step=${step} ${new Date().toISOString()}`;
    // Auditor must run in its own short-lived session so that its context
    // does not get混在しないように、専用タイトルでセッションを作る。
    const auditRes = await runOpencode(
      [
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
      ],
      auditRaw,
      false,
    );

    const auditSafety = auditRes.stdout.includes(
      "I'm sorry, but I can't assist with that request.",
    );
    if (auditSafety) {
      console.error(
        "[opencode-orchestrator] SAFETY trip detected in auditor output; treating as done=false and continuing.",
      );
    }

    const {
      done: auditDone,
      failed,
      passed,
    } = parseAuditResult(auditRes.stdout);
    stepDone = auditDone;
    if (auditDone) {
      failureBudget.consecutive_audit_failures = 0;
    } else {
      failureBudget.consecutive_audit_failures += 1;
      failureBudget.last_failure_kind = "audit_failed";
      failureBudget.last_failure_summary =
        failed[0]?.reason || "auditor が未達要件を報告した";
    }
    console.error(`[opencode-orchestrator] auditor done = ${stepDone}`);

    const reporter: AuditorReportSnapshot = {
      cycle: step,
      done: auditDone,
      requirements: failed
        .map<AuditorRequirementSnapshot>((f) => ({
          id: f.id,
          passed: false,
          reason: f.reason,
        }))
        .concat(
          passed.map<AuditorRequirementSnapshot>((id) => ({
            id,
            passed: true,
          })),
        ),
    };
    status.last_auditor_report = reporter;

    if (failed.length > 0) {
      const ids = failed.map((f) => f.id).join(", ");
      console.error(
        `[opencode-orchestrator] auditor failing requirements: ${ids}`,
      );
      for (const f of failed) {
        if (!f.reason) continue;
        const firstLine = String(f.reason).split(/\r?\n/, 1)[0];
        console.error(`[opencode-orchestrator]   - ${f.id}: ${firstLine}`);
      }
    }

    if (passed.length > 0) {
      console.error(
        `[opencode-orchestrator] auditor passed requirements: ${passed.join(", ")}`,
      );
    }

    // Best-effort cleanup: locate the dedicated auditor session by title and
    // delete it so that it does not linger in the session list.
    try {
      const auditorSessionId = await findSessionIdByTitle(auditTitle);
      if (auditorSessionId) {
        await runOpencode(
          ["session", "delete", auditorSessionId],
          undefined,
          false,
        );
      }
    } catch {
      // Cleanup failure is non-fatal; continue without aborting the loop.
    }
  } else {
    console.error(
      "[opencode-orchestrator] skipping auditor for this step (no STEP_AUDIT: ready reported by executor).",
    );
  }

  if (status.replan_required === true) {
    const baseRequest = buildReplanRequest(
      step,
      status.last_executor_step,
      status.last_auditor_report,
    );
    const issues = baseRequest?.issues ? baseRequest.issues.slice() : [];
    if (contractGapIssue) {
      issues.push(contractGapIssue);
    }
    if (verificationGapIssue) {
      issues.push(verificationGapIssue);
    }
    status.replan_request =
      issues.length > 0
        ? {
            requested_at_cycle: step,
            issues,
          }
        : null;
  } else if (verificationGapIssue || contractGapIssue) {
    status.replan_request = {
      requested_at_cycle: step,
      issues: [contractGapIssue, verificationGapIssue].filter(
        (issue): issue is ReplanIssue => issue !== null,
      ),
    };
  }
  saveStatusJson(statusPath, status);

  if (Array.isArray(status.proposals) && status.proposals.length > 0) {
    console.error(
      "[opencode-orchestrator] proposals present in status.json; stopping loop for manual intervention.",
    );
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
    `[opencode-orchestrator] exporting old session to ${safeExport}`,
  );
  const exportOld = await runOpencode(["export", sessionId], safeExport);
  if (exportOld.code !== 0) {
    const warnContext =
      context === "todo-writer" ? "todo-writer restart" : "restart";
    console.error(
      `[opencode-orchestrator] WARN: failed to export old session before ${warnContext}`,
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
      `[opencode-orchestrator] switched to new session${label}: ${newSessionId} (title: ${newTitle})`,
    );
    return newSessionId;
  }

  const warnContext =
    context === "todo-writer" ? "todo-writer restart" : "restart";
  console.error(
    `[opencode-orchestrator] WARN: failed to locate new session after ${warnContext}; continuing with previous session.`,
  );
  saveStatusJson(statusPath, status);
  return sessionId;
}
