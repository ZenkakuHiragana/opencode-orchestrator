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
  AuditorReportSnapshot,
  ExecutorStepSnapshot,
  OrchestratorStatus,
} from "./orchestrator-status.js";
import {
  parseExecutorStepSnapshot,
  saveStatusJson,
  ProposalSnapshot,
} from "./orchestrator-status.js";
import {
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
  const todowriterPrompt = buildTodoWriterPrompt();
  const planRes = await runOpencode(
    [
      "run",
      "--command",
      "orch-todo-write",
      "--session",
      sessionId,
      ...fileArgs,
      statusPath,
      "--",
      todowriterPrompt,
    ],
    todowriterLog,
  );

  const todowriterSafety = planRes.stdout.includes(
    "I'm sorry, but I can't assist with that request.",
  );
  if (todowriterSafety) {
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
      [...fileArgs, statusPath],
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
    console.error(
      "[opencode-orchestrator] todo-writer step exited with non-zero status",
    );
  }

  const todoPath = path.join(stateDir, "todo.json");
  if (fs.existsSync(todoPath)) {
    try {
      const todoRaw = fs.readFileSync(todoPath, "utf8");
      const parsed = JSON.parse(todoRaw) as { todos?: any[] } | any[];
      const todos = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { todos?: any[] }).todos)
          ? (parsed as { todos?: any[] }).todos!
          : [];
      const total = todos.length;
      const pending = todos.filter((t) => t && t.status === "pending").length;
      const inProgress = todos.filter(
        (t) => t && t.status === "in_progress",
      ).length;
      const completed = todos.filter(
        (t) => t && t.status === "completed",
      ).length;
      const cancelled = todos.filter(
        (t) => t && t.status === "cancelled",
      ).length;
      console.error(
        `[opencode-orchestrator] todo-writer todos: total=${total} ` +
          `pending=${pending} in_progress=${inProgress} ` +
          `completed=${completed} cancelled=${cancelled}`,
      );
    } catch {
      console.error(
        "[opencode-orchestrator] todo-writer todos: unknown (failed to parse todo.json)",
      );
    }
  }

  status.replan_required = false;
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

    if (fileArgs.length === 0) {
      return ["--file", statusPath];
    }
    if (fileArgs.includes(statusPath)) {
      return fileArgs;
    }
    return [...fileArgs, statusPath];
  })();

  const execPrompt = buildExecutorPrompt(isNextAfterAudit);
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
  }
  saveStatusJson(statusPath, status);

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
    saveStatusJson(statusPath, status);

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
  return sessionId;
}
