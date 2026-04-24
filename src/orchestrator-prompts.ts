import type { OrchestratorStatus } from "./orchestrator-status.js";
import type { ProposalEntry } from "./orchestrator-proposals.js";

type FailedRequirementPromptInfo = {
  id: string;
  failure_kind?: string;
  evidence_gaps?: string[];
};

function redactCommandPolicyTerms(text: string, enabled: boolean): string {
  if (!enabled) {
    return text;
  }
  return text.replace(/command-policy(?:\.json)?/gi, "command metadata");
}

function formatFailedRequirementDetails(
  failedRequirements: FailedRequirementPromptInfo[],
  hideCommandPolicyConcept = false,
): string {
  return failedRequirements
    .map((req) => {
      const kind = req.failure_kind ? ` kind=${req.failure_kind}` : "";
      const gaps =
        req.evidence_gaps && req.evidence_gaps.length > 0
          ? ` gaps=[${req.evidence_gaps
              .map((gap) =>
                redactCommandPolicyTerms(gap, hideCommandPolicyConcept),
              )
              .join("; ")}]`
          : "";
      return kind || gaps
        ? redactCommandPolicyTerms(
            `${req.id}:${kind}${gaps}`,
            hideCommandPolicyConcept,
          )
        : req.id;
    })
    .join(", ");
}

// For todo-writer/executor/auditor, the true behavior and role instructions live in
// agents/*.md as system prompts. Here we keep per-step "user" prompts as thin
// as possible to avoid poisoning the conversation history with redundant role
// descriptions. Todo-Writer does not need any extra per-step text beyond the
// attached files and its system prompt, so we return an empty string.
export function buildTodoWriterPrompt(
  status?: OrchestratorStatus,
  openProposals?: ProposalEntry[],
  hideCommandPolicyConcept = false,
): string {
  const parts: string[] = [];

  if (openProposals && openProposals.length > 0) {
    const proposalSummary = openProposals
      .map((proposal) => {
        const reqs = proposal.related_requirement_ids.join(",") || "-";
        const todos = proposal.related_todo_ids.join(",") || "-";
        return redactCommandPolicyTerms(
          `[${proposal.source}] kind=${proposal.kind} req=${reqs} todo=${todos} ${proposal.summary}`,
          hideCommandPolicyConcept,
        );
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
        (summary
          ? `Last failure summary from status.json: ${redactCommandPolicyTerms(summary, hideCommandPolicyConcept)}`
          : ""),
    );
  }

  const failedRequirements =
    status?.last_auditor_report?.requirements?.filter(
      (req) => req.passed === false,
    ) ?? [];
  if (failedRequirements.length > 0) {
    const failureDetails = formatFailedRequirementDetails(
      failedRequirements,
      hideCommandPolicyConcept,
    );
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
  hideCommandPolicyConcept = false,
): string {
  const parts: string[] = [];

  if (shouldEmphasizeAuditRead) {
    parts.push(
      "The previous loop step executed the external Auditor for this task. In this step you MUST read the latest auditor result from the `status.json`.",
    );
  }

  const failedRequirements =
    status?.last_auditor_report?.requirements?.filter(
      (req) => req.passed === false,
    ) ?? [];
  if (failedRequirements.length > 0) {
    parts.push(
      `The main open work items are those linked to auditor requirements ${failedRequirements.map((req) => req.id).join(", ")}. When choosing the next tasks, focus on Todos that contribute to satisfying these requirements.`,
    );

    const structuredFailureDetails = formatFailedRequirementDetails(
      failedRequirements,
      hideCommandPolicyConcept,
    );
    if (structuredFailureDetails.length > 0) {
      parts.push(
        `Latest auditor failure details: ${structuredFailureDetails}. Use failure_kind and evidence_gaps to decide whether this step should primarily implement missing behavior, add missing verification, or gather missing investigation evidence.`,
      );
    }
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
  auditMode: "incremental" | "final_full",
  scopeRequirementIds: string[],
): string {
  const uniqueScopeRequirementIds = Array.from(new Set(scopeRequirementIds));
  const scopeLabel =
    uniqueScopeRequirementIds.length > 0
      ? uniqueScopeRequirementIds.join(", ")
      : "ALL_ACCEPTANCE_REQUIREMENTS";
  const scopeInstructions =
    auditMode === "incremental"
      ? "This is an incremental audit. Only inspect the scoped requirement IDs listed below. Do not widen the audit beyond that subset. Even if every scoped requirement passes, you MUST return `done: false` because only a final full audit can authorize loop completion."
      : "This is the final full audit that authorizes loop completion. Inspect the full acceptance set for the story and return `done: true` only when every acceptance requirement is satisfied.";
  const requirementsInstructions =
    auditMode === "incremental"
      ? "For this incremental audit, the `requirements` array MUST contain exactly one entry for each scoped requirement ID and MUST NOT include requirements outside the scoped subset."
      : "For this final full audit, the `requirements` array MUST contain exactly one entry for every requirement in the canonical acceptance set.";

  return (
    "You are a strict external auditor for an orchestrated development loop.\n\n" +
    "The original high-level goal for this run was:\n---\n" +
    originalPrompt +
    "\n---\n\n" +
    `Audit mode: ${auditMode}.\n` +
    `Scoped requirement IDs: ${scopeLabel}.\n` +
    scopeInstructions +
    "\n" +
    requirementsInstructions +
    "\n" +
    "Use the exact requirement IDs from acceptance-index.json.\n" +
    "Respond ONLY with a single JSON object on one line with the following shape:\n" +
    '{\n  "done": true | false,\n  "requirements": [ { "id": "R1-some-requirement", "passed": true | false, "reason"?: "...", "failure_kind"?: "...", "evidence_gaps"?: ["..."] } ]\n}\n' +
    "When a requirement fails, include `reason`, `failure_kind`, and `evidence_gaps` in that requirement object.\n" +
    "If you are not certain that a requirement is fully satisfied, set its passed field to false.\n" +
    `This run is tracked under task: ${taskName}.`
  );
}

export function buildCommitPrompt(): string {
  return (
    "Create git commits for the changes made in this story, grouping related changes into coherent commits. " +
    "Use the `autocommit` tool instead of calling `git commit` directly via bash, including when the " +
    "user explicitly asks for a commit. " +
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
