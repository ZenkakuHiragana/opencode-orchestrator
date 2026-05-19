import type {
  ExecutorAuditSnapshot,
  ExecutorBlockerSnapshot,
  ExecutorCmdSnapshot,
  ExecutorDiffSnapshot,
  ExecutorIntentSnapshot,
  ExecutorStepSnapshot,
  ExecutorTodoSnapshot,
  ExecutorVerificationEvidence,
  ExecutorVerificationSnapshot,
  RequirementDiffTrace,
} from "./orchestrator-status-types.js";

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
