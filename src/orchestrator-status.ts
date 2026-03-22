import * as fs from "node:fs";
import * as path from "node:path";

export type ExecutorTodoSnapshot = {
  id: string;
  requirements: string[];
  description: string;
  from: string | null;
  to: string | null;
};

export type ExecutorDiffSnapshot = {
  path: string;
  summary: string;
};

export type ExecutorCmdSnapshot = {
  command: string;
  command_id: string | null;
  status: string;
  outcome: string;
};

export type ExecutorBlockerSnapshot = {
  scope: string;
  tag: string;
  reason: string;
};

export type ExecutorAuditSnapshot = {
  status: string;
  requirement_ids: string[];
};

export type ExecutorIntentSnapshot = {
  intent: "implement" | "verify" | "replan" | "blocked";
  requirement_ids: string[];
  summary: string;
};

export type ExecutorVerificationSnapshot = {
  status: "ready" | "not_ready" | "blocked";
  command_ids: string[];
  summary: string;
};

export type ExecutorStepSnapshot = {
  step: number;
  session_id: string;
  step_todo: ExecutorTodoSnapshot[];
  step_diff: ExecutorDiffSnapshot[];
  step_cmd: ExecutorCmdSnapshot[];
  step_blocker: ExecutorBlockerSnapshot[];
  step_intent?: ExecutorIntentSnapshot;
  step_verify?: ExecutorVerificationSnapshot;
  step_audit?: ExecutorAuditSnapshot;
  raw_stdout: string;
};

export type AuditorRequirementSnapshot = {
  id: string;
  passed: boolean;
  reason?: string;
};

export type AuditorReportSnapshot = {
  cycle: number;
  done: boolean;
  requirements: AuditorRequirementSnapshot[];
};

export type ProposalSnapshot = {
  id: string;
  source: "executor" | "auditor";
  cycle: number;
  kind: string;
  summary: string;
  details?: string;
};

export type ReplanIssue = {
  source: "executor" | "auditor";
  summary: string;
  related_todo_ids: string[];
  related_requirement_ids: string[];
};

export type ReplanRequest = {
  requested_at_cycle: number;
  issues: ReplanIssue[];
};

export type FailureBudgetSnapshot = {
  todo_writer_safety_restarts: number;
  executor_safety_restarts: number;
  consecutive_env_blocked: number;
  consecutive_audit_failures: number;
  consecutive_verification_gaps: number;
  consecutive_contract_gaps: number;
  last_failure_kind?: string;
  last_failure_summary?: string;
};

export type OrchestratorStatus = {
  version: 1;
  last_session_id?: string;
  current_cycle?: number;
  last_executor_step?: ExecutorStepSnapshot;
  last_auditor_report?: AuditorReportSnapshot;
  replan_required?: boolean;
  replan_reason?: string | null;
  replan_request?: ReplanRequest | null;
  consecutive_env_blocked?: number;
  failure_budget?: FailureBudgetSnapshot;
  proposals?: ProposalSnapshot[];
};

export function loadStatusJson(statusPath: string): OrchestratorStatus {
  if (!fs.existsSync(statusPath)) {
    return { version: 1 };
  }
  try {
    const raw = fs.readFileSync(statusPath, "utf8");
    const parsed = JSON.parse(raw) as OrchestratorStatus;
    if (!parsed || parsed.version !== 1) {
      return { version: 1 };
    }
    return parsed;
  } catch {
    return { version: 1 };
  }
}

export function saveStatusJson(
  statusPath: string,
  status: OrchestratorStatus,
): void {
  try {
    const dir = path.dirname(statusPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
  } catch {
    // Status updates are best-effort; do not break the loop on failure.
  }
}

export function buildReplanRequest(
  requestedAtCycle: number,
  lastExecutorStep?: ExecutorStepSnapshot,
  lastAuditorReport?: AuditorReportSnapshot,
): ReplanRequest | null {
  const issues: ReplanIssue[] = [];
  const executorRequirementIds = Array.from(
    new Set(
      (lastExecutorStep?.step_intent?.requirement_ids ?? []).concat(
        lastExecutorStep?.step_audit?.requirement_ids ?? [],
      ),
    ),
  );

  if (lastExecutorStep) {
    for (const blocker of lastExecutorStep.step_blocker) {
      if (blocker.tag !== "need_replan") {
        continue;
      }
      issues.push({
        source: "executor",
        summary: blocker.reason,
        related_todo_ids: blocker.scope !== "general" ? [blocker.scope] : [],
        related_requirement_ids: executorRequirementIds,
      });
    }
  }

  if (lastAuditorReport) {
    for (const requirement of lastAuditorReport.requirements) {
      if (requirement.passed) {
        continue;
      }
      issues.push({
        source: "auditor",
        summary: requirement.reason ?? "監査で未達と判定された",
        related_todo_ids: [],
        related_requirement_ids: [requirement.id],
      });
    }
  }

  if (issues.length === 0) {
    return null;
  }

  return {
    requested_at_cycle: requestedAtCycle,
    issues,
  };
}

export function parseExecutorStepSnapshot(
  stdout: string,
  sessionId: string,
  step: number,
): ExecutorStepSnapshot {
  const stepTodo: ExecutorTodoSnapshot[] = [];
  const stepDiff: ExecutorDiffSnapshot[] = [];
  const stepCmd: ExecutorCmdSnapshot[] = [];
  const stepBlocker: ExecutorBlockerSnapshot[] = [];
  let stepIntent: ExecutorIntentSnapshot | undefined;
  let stepVerify: ExecutorVerificationSnapshot | undefined;
  let stepAudit: ExecutorAuditSnapshot | undefined;

  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith("STEP_TODO:")) {
      const restAll = trimmed.slice("STEP_TODO:".length).trim();
      if (!restAll) continue;
      const lastParen = restAll.lastIndexOf("(");
      const lastClose = restAll.lastIndexOf(")");
      let before = restAll;
      let from: string | null = null;
      let to: string | null = null;
      if (lastParen !== -1 && lastClose !== -1 && lastClose > lastParen) {
        before = restAll.slice(0, lastParen).trim();
        const statusPart = restAll.slice(lastParen + 1, lastClose).trim();
        const unicodeArrow = statusPart.indexOf("→");
        const asciiArrow = statusPart.indexOf("->");
        const arrow = unicodeArrow !== -1 ? unicodeArrow : asciiArrow;
        if (arrow !== -1) {
          from = statusPart.slice(0, arrow).trim();
          to = statusPart.slice(arrow + (unicodeArrow !== -1 ? 1 : 2)).trim();
        }
      }
      const firstSpace = before.indexOf(" ");
      if (firstSpace === -1) continue;
      const id = before.slice(0, firstSpace).trim();
      const afterId = before.slice(firstSpace + 1).trim();
      if (!afterId) continue;
      const secondSpace = afterId.indexOf(" ");
      let reqPart: string;
      let desc: string;
      if (secondSpace === -1) {
        reqPart = afterId;
        desc = "";
      } else {
        reqPart = afterId.slice(0, secondSpace).trim();
        desc = afterId.slice(secondSpace + 1).trim();
      }
      const requirements =
        reqPart === "-"
          ? []
          : reqPart
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
      stepTodo.push({ id, requirements, description: desc, from, to });
      continue;
    }

    if (trimmed.startsWith("STEP_DIFF:")) {
      const rest = trimmed.slice("STEP_DIFF:".length).trim();
      if (!rest) continue;
      const firstSpace = rest.indexOf(" ");
      let filePath: string;
      let summary: string;
      if (firstSpace === -1) {
        filePath = rest;
        summary = "";
      } else {
        filePath = rest.slice(0, firstSpace).trim();
        summary = rest.slice(firstSpace + 1).trim();
      }
      stepDiff.push({ path: filePath, summary });
      continue;
    }

    if (trimmed.startsWith("STEP_CMD:")) {
      const restAll = trimmed.slice("STEP_CMD:".length).trim();
      if (!restAll) continue;
      const close = restAll.lastIndexOf(")");
      const open = close !== -1 ? restAll.lastIndexOf("(", close) : -1;
      if (open === -1 || close === -1 || close <= open) {
        stepCmd.push({
          command: restAll,
          command_id: null,
          status: "",
          outcome: "",
        });
        continue;
      }
      const command = restAll.slice(0, open).trim();
      const commandIdRaw = restAll.slice(open + 1, close).trim();
      const after = restAll.slice(close + 1).trim();
      if (!after) {
        stepCmd.push({
          command,
          command_id: commandIdRaw || null,
          status: "",
          outcome: "",
        });
        continue;
      }
      const firstSpace = after.indexOf(" ");
      let statusVal: string;
      let outcome: string;
      if (firstSpace === -1) {
        statusVal = after;
        outcome = "";
      } else {
        statusVal = after.slice(0, firstSpace).trim();
        outcome = after.slice(firstSpace + 1).trim();
      }
      stepCmd.push({
        command,
        command_id: commandIdRaw && commandIdRaw !== "-" ? commandIdRaw : null,
        status: statusVal,
        outcome,
      });
      continue;
    }

    if (trimmed.startsWith("STEP_BLOCKER:")) {
      const rest = trimmed.slice("STEP_BLOCKER:".length).trim();
      if (!rest) continue;
      const firstSpace = rest.indexOf(" ");
      if (firstSpace === -1) continue;
      const scope = rest.slice(0, firstSpace).trim();
      const afterScope = rest.slice(firstSpace + 1).trim();
      const secondSpace = afterScope.indexOf(" ");
      if (secondSpace === -1) continue;
      const tag = afterScope.slice(0, secondSpace).trim();
      const reason = afterScope.slice(secondSpace + 1).trim();
      stepBlocker.push({ scope, tag, reason });
      continue;
    }

    if (trimmed.startsWith("STEP_INTENT:")) {
      const rest = trimmed.slice("STEP_INTENT:".length).trim();
      if (!rest) continue;
      const firstSpace = rest.indexOf(" ");
      if (firstSpace === -1) continue;
      const intent = rest.slice(0, firstSpace).trim() as
        | "implement"
        | "verify"
        | "replan"
        | "blocked";
      const afterIntent = rest.slice(firstSpace + 1).trim();
      if (!afterIntent) continue;
      const idList = splitLeadingIdList(afterIntent);
      if (!idList) continue;
      const { idsPart, summary } = idList;
      if (
        intent !== "implement" &&
        intent !== "verify" &&
        intent !== "replan" &&
        intent !== "blocked"
      ) {
        continue;
      }
      const requirementIds =
        idsPart && idsPart !== "-"
          ? idsPart
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
      stepIntent = { intent, requirement_ids: requirementIds, summary };
      continue;
    }

    if (trimmed.startsWith("STEP_VERIFY:")) {
      const rest = trimmed.slice("STEP_VERIFY:".length).trim();
      if (!rest) continue;
      const firstSpace = rest.indexOf(" ");
      if (firstSpace === -1) continue;
      const statusVal = rest.slice(0, firstSpace).trim() as
        | "ready"
        | "not_ready"
        | "blocked";
      const afterStatus = rest.slice(firstSpace + 1).trim();
      if (!afterStatus) continue;
      const idList = splitLeadingIdList(afterStatus);
      if (!idList) continue;
      const { idsPart, summary } = idList;
      if (
        statusVal !== "ready" &&
        statusVal !== "not_ready" &&
        statusVal !== "blocked"
      ) {
        continue;
      }
      const commandIds =
        idsPart && idsPart !== "-"
          ? idsPart
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
      stepVerify = { status: statusVal, command_ids: commandIds, summary };
      continue;
    }

    if (trimmed.startsWith("STEP_AUDIT:")) {
      const rest = trimmed.slice("STEP_AUDIT:".length).trim();
      if (!rest) continue;
      const firstSpace = rest.indexOf(" ");
      if (firstSpace === -1) continue;
      const statusVal = rest.slice(0, firstSpace).trim();
      const idsPart = rest.slice(firstSpace + 1).trim();
      if (statusVal !== "ready" && statusVal !== "in_progress") {
        continue;
      }
      const requirementIds =
        idsPart && idsPart !== "-"
          ? idsPart
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
      stepAudit = { status: statusVal, requirement_ids: requirementIds };
      continue;
    }
  }

  return {
    step,
    session_id: sessionId,
    step_todo: stepTodo,
    step_diff: stepDiff,
    step_cmd: stepCmd,
    step_blocker: stepBlocker,
    step_intent: stepIntent,
    step_verify: stepVerify,
    step_audit: stepAudit,
    raw_stdout: stdout,
  };
}

function splitLeadingIdList(
  input: string,
): { idsPart: string; summary: string } | null {
  if (!input) {
    return null;
  }

  if (input === "-") {
    return { idsPart: "-", summary: "" };
  }

  if (input.startsWith("- ")) {
    return { idsPart: "-", summary: input.slice(2).trim() };
  }

  const match = input.match(/^([^,\s]+(?:,\s*[^,\s]+)*)(?:\s+(.*))?$/);
  if (!match) {
    return null;
  }

  return {
    idsPart: match[1],
    summary: match[2]?.trim() ?? "",
  };
}
