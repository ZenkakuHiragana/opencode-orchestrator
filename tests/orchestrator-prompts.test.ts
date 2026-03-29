import { describe, expect, it } from "vitest";

import {
  buildExecutorPrompt,
  buildTodoWriterPrompt,
} from "../src/orchestrator-prompts.js";

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
  });

  it("returns an empty prompt when there are no open proposals or status hints", () => {
    const prompt = buildTodoWriterPrompt({ version: 1 });

    expect(prompt).toBe("");
    expect(prompt).not.toContain("replan_request");
  });
});
