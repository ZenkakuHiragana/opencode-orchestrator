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
      "Prioritize the still-failing auditor requirements first: R6",
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
    const prompt = buildTodoWriterPrompt({
      version: 1,
      replan_request: {
        requested_at_cycle: 4,
        issues: [
          {
            source: "executor",
            summary: "todo の証拠境界を狭めたい",
            related_todo_ids: ["TW-009"],
            related_requirement_ids: ["R6"],
          },
        ],
      },
    });

    expect(prompt).toContain("status.json.replan_request");
    expect(prompt).toContain("TW-009");
    expect(prompt).toContain("R6");
  });
});
