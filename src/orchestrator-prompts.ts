import type { OrchestratorStatus } from "./orchestrator-status.js";
import type { ProposalEntry } from "./orchestrator-proposals.js";

// Core role contracts live in agents/*.md, while longer reusable procedures now
// live in packaged skills exposed through permission.skill allowlists. Here we
// keep per-step "user" prompts as thin as possible so the conversation history
// carries only step-local nudges instead of reloading role contracts or long
// procedures on every step. Todo-Writer does not need extra per-step text
// beyond attached files and these small nudges, so we return an empty string
// when no status/proposal hints exist.
export function buildTodoWriterPrompt(
  status?: OrchestratorStatus,
  openProposals?: ProposalEntry[],
): string {
  const parts: string[] = [];

  if (openProposals && openProposals.length > 0) {
    const proposalSummary = openProposals
      .map((proposal) => {
        const reqs = proposal.related_requirement_ids.join(",") || "-";
        const todos = proposal.related_todo_ids.join(",") || "-";
        return `[${proposal.source}] kind=${proposal.kind} req=${reqs} todo=${todos} ${proposal.summary}`;
      })
      .join("; ");
    parts.push(
      "This planning pass must re-check unresolved proposals from proposals.json and sharpen the canonical todos around them: " +
        proposalSummary,
    );
  }

  if (status?.failure_budget?.consecutive_verification_gaps) {
    parts.push(
      "Recent executor steps declared audit-ready work without sufficient STEP_VERIFY evidence. Strengthen todo boundaries so each affected todo makes the required verification evidence and audit-ready condition explicit.",
    );
  }

  if (
    status?.failure_budget?.last_failure_kind ===
    "todo_writer_coverage_invariant_failed"
  ) {
    const summary = status.failure_budget.last_failure_summary ?? "";
    parts.push(
      "The last Todo-Writer pass produced a todo.json that violated dynamic coverage invariants. " +
        "You MUST ensure that every unsatisfied requirement from acceptance-index.json has at least one active todo (`pending` or `in_progress`) whose related_requirement_ids includes that requirement id. " +
        (summary ? `Last failure summary from status.json: ${summary}` : ""),
    );
  }

  const failedRequirements =
    status?.last_auditor_report?.requirements?.filter(
      (req) => req.passed === false,
    ) ?? [];
  if (failedRequirements.length > 0) {
    const failureDetails = failedRequirements
      .map((req) => {
        const kind = req.failure_kind ? ` kind=${req.failure_kind}` : "";
        const gaps =
          req.evidence_gaps && req.evidence_gaps.length > 0
            ? ` gaps=[${req.evidence_gaps.join("; ")}]`
            : "";
        return `${req.id}:${kind}${gaps}`;
      })
      .join(", ");
    parts.push(
      `The auditor reported failed requirements with structured failure information: ${failureDetails}. ` +
        "Use failure_kind to determine what type of todo to add (investigate, verify, or implement), " +
        "and use evidence_gaps as concrete requirements for new todo execution_contract.expected_evidence.",
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
      `The main open work items are those linked to auditor requirements ${failedRequirements.join(", ")}. When choosing the next tasks, focus on Todos that contribute to satisfying these requirements.`,
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

export function withTaskKeyHint(base: string, taskName: string): string {
  const hint = `TASK KEY: ${taskName}`;
  if (!base || base.trim().length === 0) {
    return hint;
  }
  if (base.includes(hint)) {
    return base;
  }
  return `${base}\n\n${hint}`;
}
