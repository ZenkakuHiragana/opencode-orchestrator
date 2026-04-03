import * as fs from "node:fs";
import * as path from "node:path";

import { t } from "./i18n/messages.js";
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import {
  listKnownTasks,
  sortTasksByRecency,
  suggestRecentTasks,
} from "./task-resolution.js";

export interface StatusCommandOptions {
  argv: string[];
}

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
  intent: "implement" | "verify" | "investigate" | "replan" | "blocked";
  requirement_ids: string[];
  summary: string;
};

export type ExecutorVerificationSnapshot = {
  status: "ready" | "not_ready" | "blocked";
  command_ids: string[];
  summary: string;
};

export type ExecutorVerificationEvidence = {
  hasEvidence: boolean;
  reason: "command_ids" | "diffs" | "missing";
};

export type RequirementDiffTrace = {
  requirement_id: string;
  representative_files: string[];
};

export type ExecutorStepSnapshot = {
  step: number;
  session_id: string;
  step_todo: ExecutorTodoSnapshot[];
  step_diff: ExecutorDiffSnapshot[];
  requirement_traceability: RequirementDiffTrace[];
  step_cmd: ExecutorCmdSnapshot[];
  step_blocker: ExecutorBlockerSnapshot[];
  step_intent?: ExecutorIntentSnapshot;
  step_verify?: ExecutorVerificationSnapshot;
  step_audit?: ExecutorAuditSnapshot;
  raw_stdout: string;
};

export type AuditorFailureKind =
  | "missing_implementation"
  | "incomplete_implementation"
  | "missing_verification"
  | "weak_evidence"
  | "missing_investigation"
  | "artifact_mismatch"
  | "scope_unclear";

export type AuditorRequirementSnapshot = {
  id: string;
  passed: boolean;
  reason?: string;
  failure_kind?: AuditorFailureKind;
  evidence_gaps?: string[];
};

export type AuditorReportSnapshot = {
  cycle: number;
  done: boolean;
  requirements: AuditorRequirementSnapshot[];
};

export type FailureBudgetSnapshot = {
  todo_writer_safety_restarts: number;
  executor_safety_restarts: number;
  // Number of consecutive executor safety trips observed **within the same
  // opencode session**. This lets the loop try to continue inside a "poisoned"
  // session a few times before giving up and calling restartSession.
  executor_safety_consecutive_in_session?: number;
  executor_safety_last_session_id?: string;
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
  consecutive_env_blocked?: number;
  failure_budget?: FailureBudgetSnapshot;
};

export async function runStatusCommand(
  opts: StatusCommandOptions,
): Promise<number> {
  const args = [...opts.argv];

  let explicitTask: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--task") {
      explicitTask = args[i + 1];
      break;
    }
  }

  const knownInfos = listKnownTasks();
  const knownTasks = knownInfos.map((info) => info.task);

  let task: string;

  if (!explicitTask) {
    if (knownTasks.length === 0) {
      console.error(t("cli.status.error.no_tasks_found"));
      return 1;
    }
    if (knownTasks.length > 1) {
      const recent = sortTasksByRecency(knownInfos, 5);
      const shown = recent.map((info) => info.task);
      console.error(
        t("cli.status.error.multiple_tasks", {
          tasks: shown.join(", "),
        }),
      );
      if (knownTasks.length > shown.length) {
        console.error(t("cli.status.info.multiple_tasks_hint_use_list"));
      }
      return 1;
    }
    task = knownTasks[0];
  } else {
    if (knownTasks.length === 0) {
      console.error(
        t("cli.status.error.unknown_task_no_suggestions", {
          input: explicitTask,
        }),
      );
      return 1;
    }

    if (!knownTasks.includes(explicitTask)) {
      const suggestions = suggestRecentTasks(explicitTask, knownInfos, 5);
      if (suggestions.length > 0) {
        const names = suggestions.join(", ");
        console.error(
          t("cli.status.error.unknown_task_with_suggestions", {
            input: explicitTask,
            candidates: names,
          }),
        );
        if (knownInfos.length > suggestions.length) {
          console.error(t("cli.status.info.unknown_task_hint_use_list"));
        }
        return 1;
      }

      console.error(
        t("cli.status.error.unknown_task_no_suggestions", {
          input: explicitTask,
        }),
      );
      return 1;
    }

    task = explicitTask;
  }
  const exitCode = printStatusSummary(task);
  return exitCode;
}

function derivePhase(
  loopStatus: string | null,
  status: OrchestratorStatus,
): "planning" | "execution_ready" | "env_blocked" | "completed" | "unknown" {
  if (loopStatus === "needs_refinement") return "planning";
  if (loopStatus === "blocked_by_environment") return "env_blocked";
  if (loopStatus === "ready_for_loop") return "execution_ready";

  const report = status.last_auditor_report;
  if (
    report &&
    report.done &&
    Array.isArray(report.requirements) &&
    report.requirements.length > 0 &&
    report.requirements.every((r) => r.passed)
  ) {
    return "completed";
  }

  return "unknown";
}

function countOpenProposals(proposalsPath: string): number {
  if (!fs.existsSync(proposalsPath)) return 0;
  try {
    const raw = fs.readFileSync(proposalsPath, "utf8");
    const json = JSON.parse(raw) as {
      proposals?: { status?: string }[];
    };
    if (!json.proposals || !Array.isArray(json.proposals)) return 0;
    return json.proposals.filter((p) => p.status === "open").length;
  } catch {
    return 0;
  }
}

function readLoopStatus(policyPath: string): string | null {
  try {
    const raw = fs.readFileSync(policyPath, "utf8");
    const json = JSON.parse(raw) as {
      summary?: { loop_status?: string };
    };
    const s = json.summary?.loop_status;
    return typeof s === "string" ? s : null;
  } catch {
    return null;
  }
}

function printStatusSummary(task: string): number {
  const stateDir = getOrchestratorStateDir(task);
  if (!fs.existsSync(stateDir) || !fs.statSync(stateDir).isDirectory()) {
    console.error(t("cli.status.error.state_missing", { task }));
    return 1;
  }

  const statusPath = path.join(stateDir, "status.json");
  const policyPath = path.join(stateDir, "command-policy.json");
  const proposalsPath = path.join(stateDir, "proposals.json");

  const status = loadStatusJson(statusPath);
  const loopStatus = readLoopStatus(policyPath);
  const phase = derivePhase(loopStatus, status);
  const openCount = countOpenProposals(proposalsPath);
  const lastFailureSummary =
    status.failure_budget?.last_failure_summary?.trim() || "";

  console.error(t("cli.status.summary.header", { task }));

  switch (phase) {
    case "planning":
      console.error(t("cli.status.summary.phase.planning"));
      break;
    case "execution_ready":
      console.error(t("cli.status.summary.phase.execution_ready"));
      break;
    case "env_blocked":
      console.error(t("cli.status.summary.phase.env_blocked"));
      break;
    case "completed":
      console.error(t("cli.status.summary.phase.completed"));
      break;
    default:
      console.error(t("cli.status.summary.phase.unknown"));
      break;
  }

  if (lastFailureSummary.length > 0) {
    console.error(
      t("cli.status.summary.last_failure", {
        summary: lastFailureSummary,
      }),
    );
  }

  if (openCount === 0) {
    console.error(t("cli.status.summary.open_proposals.none"));
  } else {
    console.error(
      t("cli.status.summary.open_proposals.some", {
        count: String(openCount),
      }),
    );
  }

  let nextActionKey: string;
  switch (phase) {
    case "planning":
      nextActionKey = "cli.status.summary.next_action.planning";
      break;
    case "env_blocked":
      nextActionKey = "cli.status.summary.next_action.env_blocked";
      break;
    case "execution_ready":
      nextActionKey = "cli.status.summary.next_action.execution_ready";
      break;
    case "completed":
      nextActionKey = "cli.status.summary.next_action.completed";
      break;
    default:
      nextActionKey = "cli.status.summary.next_action.unknown";
      break;
  }

  console.error(
    t(nextActionKey as any, {
      task,
    }),
  );

  return 0;
}

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
        | "investigate"
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
        intent !== "investigate" &&
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
    requirement_traceability: buildRequirementDiffTrace({
      step_todo: stepTodo,
      step_diff: stepDiff,
      step_intent: stepIntent,
      step_audit: stepAudit,
    }),
    step_cmd: stepCmd,
    step_blocker: stepBlocker,
    step_intent: stepIntent,
    step_verify: stepVerify,
    step_audit: stepAudit,
    raw_stdout: stdout,
  };
}

export function getExecutorVerificationEvidence(
  step: Pick<ExecutorStepSnapshot, "step_verify" | "step_diff">,
): ExecutorVerificationEvidence {
  const verify = step.step_verify;
  if (!verify || verify.status !== "ready") {
    return { hasEvidence: false, reason: "missing" };
  }

  if (verify.command_ids.length > 0) {
    return { hasEvidence: true, reason: "command_ids" };
  }

  if (step.step_diff.length > 0) {
    return { hasEvidence: true, reason: "diffs" };
  }
  return { hasEvidence: false, reason: "missing" };
}

export function buildRequirementDiffTrace(
  step: Pick<
    ExecutorStepSnapshot,
    "step_todo" | "step_diff" | "step_intent" | "step_audit"
  >,
): RequirementDiffTrace[] {
  const files = Array.from(new Set(step.step_diff.map((diff) => diff.path)));
  if (files.length === 0) {
    return [];
  }

  const requirementIds = Array.from(
    new Set(
      step.step_todo
        .flatMap((todo) => todo.requirements)
        .concat(
          step.step_intent?.requirement_ids ?? [],
          step.step_audit?.requirement_ids ?? [],
        ),
    ),
  );

  return requirementIds.map((requirementId) => ({
    requirement_id: requirementId,
    representative_files: files,
  }));
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
