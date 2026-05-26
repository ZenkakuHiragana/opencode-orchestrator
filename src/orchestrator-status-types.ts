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
  audit_mode?: "incremental" | "final_full";
  scope_requirement_ids?: string[];
  done: boolean;
  requirements: AuditorRequirementSnapshot[];
};

export type StatusPhase =
  | "planning"
  | "proposal_blocked"
  | "execution_ready"
  | "env_blocked"
  | "completed"
  | "unknown";

export type TaskStatusSnapshot = {
  task: string;
  stateDir: string;
  status: OrchestratorStatus;
  loopStatus: string | null;
  phase: StatusPhase;
  openProposalCount: number;
  blockingOpenProposalCount: number;
  latestBlockingOpenProposalSummary: string;
  latestOpenProposalSummary: string;
  lastFailureSummary: string;
};

export type FailureBudgetSnapshot = {
  todo_writer_safety_restarts: number;
  executor_safety_restarts: number;
  executor_safety_consecutive_in_session?: number;
  executor_safety_last_session_id?: string;
  executor_opencode_error_consecutive_in_session?: number;
  executor_opencode_error_last_session_id?: string;
  consecutive_env_blocked: number;
  consecutive_audit_failures: number;
  consecutive_verification_gaps: number;
  consecutive_contract_gaps: number;
  semantic_noop_replans?: number;
  semantic_noop_requirement_key?: string;
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
