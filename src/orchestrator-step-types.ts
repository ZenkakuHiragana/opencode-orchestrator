import type { FailureBudgetSnapshot } from "./orchestrator-status.js";

export type TodoWriterStepResult = {
  sessionId: string;
  restartCount: number;
  forceTodoWriterNextStep: boolean;
  restartedSession: boolean;
  abortLoop: boolean;
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

export type AuditorPassResult = {
  done: boolean;
  failed: import("./orchestrator-audit.js").AuditSummary["failed"];
  passed: string[];
  parseError: string | null;
  report: import("./orchestrator-status.js").AuditorReportSnapshot;
};

export type TodoSummary =
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

export type CoverageCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

export type MinimalTodo = {
  id: string;
  summary: string;
  status: string;
  related_requirement_ids: string[];
  intent?: string;
  expected_evidence?: string[];
  command_ids?: string[];
  audit_ready_when?: string[];
  artifact_schema?: string;
  artifact_filename?: string;
};

export type ExecutorOpencodeInfraErrorKind =
  | "unexpected_error"
  | "reasoning_item_missing";

export type ExecutorOpencodeInfraError = {
  kind: ExecutorOpencodeInfraErrorKind;
  message: string;
};

export type EnsureFailureBudget = (
  status: import("./orchestrator-status.js").OrchestratorStatus,
) => FailureBudgetSnapshot;
