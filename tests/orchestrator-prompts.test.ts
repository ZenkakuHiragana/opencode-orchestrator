import { describe, expect, it } from "vitest";

import {
  buildExecutorPrompt,
  buildCommitPrompt,
  buildTodoWriterPrompt,
} from "../src/orchestrator-prompts.js";

describe("buildCommitPrompt", () => {
  it("allows autocommit when the user explicitly asks for a commit", () => {
    const prompt = buildCommitPrompt();

    expect(prompt).toContain("user explicitly asks for a commit");
    expect(prompt).toContain("autocommit");
  });
});

describe("buildExecutorPrompt", () => {
  it("includes failed requirement prioritization from auditor report", () => {
    const prompt = buildExecutorPrompt(false, {
      version: 1,
      last_auditor_report: {
        cycle: 2,
        done: false,
        requirements: [{ id: "R6", passed: false }],
      },
    });

    expect(prompt).toContain(
      "The main open work items are those linked to auditor requirements R6",
    );
  });

  it("includes structured auditor failure details for executor remediation", () => {
    const prompt = buildExecutorPrompt(false, {
      version: 1,
      last_auditor_report: {
        cycle: 2,
        done: false,
        requirements: [
          {
            id: "R6",
            passed: false,
            failure_kind: "missing_verification",
            evidence_gaps: ["No regression command covers the auth flow"],
          },
        ],
      },
    });

    expect(prompt).toContain("Latest auditor failure details:");
    expect(prompt).toContain("R6: kind=missing_verification");
    expect(prompt).toContain(
      "gaps=[No regression command covers the auth flow]",
    );
    expect(prompt).toContain("failure_kind and evidence_gaps");
  });

  it("warns about verification gaps when consecutive_verification_gaps > 0", () => {
    const prompt = buildExecutorPrompt(false, {
      version: 1,
      failure_budget: {
        todo_writer_safety_restarts: 0,
        executor_safety_restarts: 0,
        consecutive_env_blocked: 0,
        consecutive_audit_failures: 0,
        consecutive_verification_gaps: 1,
        consecutive_contract_gaps: 0,
        last_failure_kind: "verification_gap",
        last_failure_summary: "STEP_VERIFY evidence insufficient",
      },
    });

    expect(prompt).toContain("STEP_AUDIT: ready");
    expect(prompt).toContain("STEP_VERIFY: ready");
  });

  it("adds audit-read reminder when shouldEmphasizeAuditRead is true", () => {
    const prompt = buildExecutorPrompt(true, { version: 1 });

    expect(prompt).toContain(
      "MUST read the latest auditor result from the `status.json`",
    );
  });

  it("redacts command-policy terminology from auditor failure details when requested", () => {
    const prompt = buildExecutorPrompt(
      false,
      {
        version: 1,
        last_auditor_report: {
          cycle: 2,
          done: false,
          requirements: [
            {
              id: "R6",
              passed: false,
              failure_kind: "missing_verification",
              evidence_gaps: ["command-policy.json is missing for this check"],
            },
          ],
        },
      },
      true,
    );

    expect(prompt).not.toContain("command-policy");
    expect(prompt).toContain("command metadata");
  });
});

describe("buildTodoWriterPrompt", () => {
  it("keeps replan guidance focused on normalized handoff issues", () => {
    const prompt = buildTodoWriterPrompt(
      {
        version: 1,
        last_session_id: "sess-1",
      },
      [
        {
          id: "p-1",
          source: "executor",
          cycle: 4,
          kind: "need_replan",
          priority: "high",
          summary: "todo の証拠境界を狭めたい",
          related_todo_ids: ["TW-009"],
          related_requirement_ids: ["R6"],
          status: "open",
          auto_resolvable: true,
          created_at: "2026-03-29T00:00:00.000Z",
        },
      ],
    );

    expect(prompt).toContain("proposals.json");
    expect(prompt).toContain("kind=need_replan");
    expect(prompt).toContain("TW-009");
    expect(prompt).toContain("R6");
    expect(prompt).toContain("executor-runnable");
  });

  it("returns an empty prompt when there are no open proposals or status hints", () => {
    const prompt = buildTodoWriterPrompt({ version: 1 });

    expect(prompt).toBe("");
    expect(prompt).not.toContain("replan_request");
  });

  it("surfaces coverage invariant failures from failure_budget to todo-writer", () => {
    const prompt = buildTodoWriterPrompt({
      version: 1,
      failure_budget: {
        todo_writer_safety_restarts: 0,
        executor_safety_restarts: 0,
        consecutive_env_blocked: 0,
        consecutive_audit_failures: 0,
        consecutive_verification_gaps: 0,
        consecutive_contract_gaps: 0,
        last_failure_kind: "todo_writer_coverage_invariant_failed",
        last_failure_summary:
          "todo-writer が coverage invariants を満たさない todo.json を生成したため再計画状態を維持する: coverage invariant violated for requirements without active todos: R1",
      },
    } as any);

    expect(prompt).toContain("coverage invariants");
    expect(prompt).toContain("Last failure summary from status.json");
    expect(prompt).toContain("R1");
  });

  it("surfaces non-dispatch active todo failures from failure_budget to todo-writer", () => {
    const prompt = buildTodoWriterPrompt({
      version: 1,
      failure_budget: {
        todo_writer_safety_restarts: 0,
        executor_safety_restarts: 0,
        consecutive_env_blocked: 0,
        consecutive_audit_failures: 0,
        consecutive_verification_gaps: 0,
        consecutive_contract_gaps: 0,
        last_failure_kind: "todo_writer_non_dispatch_active_todos",
        last_failure_summary:
          "todo-writer が Executor 非実行の待機 todo を生成したため再計画状態を維持する: active todos must be executor-runnable",
      },
    } as any);

    expect(prompt).toContain("non-dispatch active todos");
    expect(prompt).toContain("Replace planner-only holds");
    expect(prompt).toContain("executor-runnable");
  });

  it("surfaces semantic no-op replan rejection from failure_budget to todo-writer", () => {
    const prompt = buildTodoWriterPrompt({
      version: 1,
      failure_budget: {
        todo_writer_safety_restarts: 0,
        executor_safety_restarts: 0,
        consecutive_env_blocked: 0,
        consecutive_audit_failures: 0,
        consecutive_verification_gaps: 0,
        consecutive_contract_gaps: 0,
        last_failure_kind: "todo_writer_semantic_noop_replan",
        last_failure_summary:
          "todo-writer changed todo.json but did not add semantic repo-visible progress for any open auto-resolvable proposal. related requirements: R1.",
      },
    } as any);

    expect(prompt).toContain("semantic no-op replanning");
    expect(prompt).toContain("verification, reconciliation, boundary");
    expect(prompt).toContain("implementation todo");
    expect(prompt).toContain("investigation todo");
    expect(prompt).toContain("R1");
  });

  it("redacts command-policy terminology when skip-command-policy mode hides the concept", () => {
    const prompt = buildTodoWriterPrompt(
      {
        version: 1,
        failure_budget: {
          todo_writer_safety_restarts: 0,
          executor_safety_restarts: 0,
          consecutive_env_blocked: 0,
          consecutive_audit_failures: 0,
          consecutive_verification_gaps: 0,
          consecutive_contract_gaps: 0,
          last_failure_kind: "todo_writer_coverage_invariant_failed",
          last_failure_summary:
            "command-policy.json must be refreshed before replanning",
        },
      } as any,
      [
        {
          id: "p-2",
          source: "executor",
          cycle: 5,
          kind: "env_blocked",
          priority: "high",
          summary: "executor is blocked by command-policy mismatch",
          related_todo_ids: ["TW-010"],
          related_requirement_ids: ["R7"],
          status: "open",
          auto_resolvable: false,
          created_at: "2026-03-30T00:00:00.000Z",
        },
      ],
      true,
    );

    expect(prompt).not.toContain("command-policy");
    expect(prompt).toContain("command metadata");
  });
});
