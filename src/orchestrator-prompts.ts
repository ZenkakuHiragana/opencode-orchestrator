import type { OrchestratorStatus } from "./orchestrator-status.js";

// For todo-writer/executor/auditor, the true behavior and role instructions live in
// agents/*.md as system prompts. Here we keep per-step "user" prompts as thin
// as possible to avoid poisoning the conversation history with redundant role
// descriptions. Todo-Writer does not need any extra per-step text beyond the
// attached files and its system prompt, so we return an empty string.
export function buildTodoWriterPrompt(status?: OrchestratorStatus): string {
  const parts: string[] = [];

  if (
    status?.replan_request?.issues &&
    status.replan_request.issues.length > 0
  ) {
    const issueSummary = status.replan_request.issues
      .map((issue) => {
        const reqs = issue.related_requirement_ids.join(",") || "-";
        const todos = issue.related_todo_ids.join(",") || "-";
        return `[${issue.source}] req=${reqs} todo=${todos} ${issue.summary}`;
      })
      .join("; ");
    parts.push(
      "This planning pass is a replan. Use status.json.replan_request as the primary normalized handoff and sharpen the canonical todos around those issues: " +
        issueSummary,
    );
  }

  if (status?.failure_budget?.consecutive_verification_gaps) {
    parts.push(
      "Recent executor steps declared audit-ready work without sufficient STEP_VERIFY evidence. Strengthen todo boundaries so each affected todo makes the required verification evidence and audit-ready condition explicit.",
    );
  }

  return parts.join(" ");
}

export function buildExecutorPrompt(
  shouldEmphasizeAuditRead: boolean,
  status?: OrchestratorStatus,
): string {
  const parts: string[] = [];

  if (shouldEmphasizeAuditRead) {
    parts.push(
      "The previous loop step executed the external Auditor for this task. In this step you MUST read the latest auditor result from the `status.json`.",
    );
  }

  const failedRequirements =
    status?.last_auditor_report?.requirements
      ?.filter((req) => req.passed === false)
      .map((req) => req.id) ?? [];
  if (failedRequirements.length > 0) {
    parts.push(
      `Prioritize the still-failing auditor requirements first: ${failedRequirements.join(", ")}.`,
    );
  }

  if ((status?.failure_budget?.consecutive_verification_gaps ?? 0) > 0) {
    parts.push(
      "Do not emit `STEP_AUDIT: ready` unless you also emit `STEP_VERIFY: ready` with concrete command IDs or an explicit no-command evidence reason.",
    );
  }

  return parts.join(" ");
}

export function buildAuditPrompt(
  originalPrompt: string,
  taskName: string,
): string {
  return (
    "You are a strict external auditor for an orchestrated development loop.\n\n" +
    "The original high-level goal for this run was:\n---\n" +
    originalPrompt +
    "\n---\n\n" +
    "Decide whether the current story is fully completed according to its acceptance criteria and the verification gates relevant to the changes.\n" +
    "Respond ONLY with a single JSON object on one line with the following shape:\n" +
    '{\n  "done": true | false,\n  "requirements": [ { "id": "R1-some-requirement", "passed": true | false } ]\n}\n' +
    "If you are not certain that a requirement is fully satisfied, set its passed field to false.\n" +
    `This run is tracked under task: ${taskName}.`
  );
}

export function buildCommitPrompt(): string {
  return (
    "Create git commits for the changes made in this story, grouping related changes into coherent commits. " +
    "Use the `autocommit` tool instead of calling `git commit` directly via bash. " +
    "Only commit changes that are appropriate for this task, and avoid committing build artifacts, " +
    "task artifacts under ./opencode/orchestrator, or secrets. " +
    "If no commit is needed, explain why."
  );
}
