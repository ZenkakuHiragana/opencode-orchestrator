import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildReplanRequest,
  buildRequirementDiffTrace,
  getExecutorVerificationEvidence,
  parseExecutorStepSnapshot,
  loadStatusJson,
  saveStatusJson,
  type OrchestratorStatus,
} from "../src/orchestrator-status.js";

describe("parseExecutorStepSnapshot", () => {
  it("parses STEP_* lines into a structured snapshot", () => {
    const stdout = [
      "STEP_TODO: T1 R1,R2 implement change (pending → completed)",
      "STEP_DIFF: src/foo.ts added endpoint",
      "STEP_CMD: npm test (cmd-npm-test) success テスト成功",
      "STEP_BLOCKER: general need_replan タスクが大きすぎる",
      "STEP_INTENT: implement R1,R2 auth flow を修正した",
      "STEP_VERIFY: ready cmd-npm-test テスト根拠が揃った",
      "STEP_AUDIT: ready R1,R2",
      "some unrelated log line",
    ].join("\n");

    const snapshot = parseExecutorStepSnapshot(stdout, "sess-1", 3);

    expect(snapshot.step).toBe(3);
    expect(snapshot.session_id).toBe("sess-1");

    expect(snapshot.step_todo).toHaveLength(1);
    const todo = snapshot.step_todo[0];
    expect(todo.id).toBe("T1");
    expect(todo.requirements).toEqual(["R1", "R2"]);
    expect(todo.description).toBe("implement change");
    expect(todo.from).toBe("pending");
    expect(todo.to).toBe("completed");

    expect(snapshot.step_diff).toHaveLength(1);
    expect(snapshot.step_diff[0]).toEqual({
      path: "src/foo.ts",
      summary: "added endpoint",
    });

    expect(snapshot.requirement_traceability).toEqual([
      {
        requirement_id: "R1",
        representative_files: ["src/foo.ts"],
      },
      {
        requirement_id: "R2",
        representative_files: ["src/foo.ts"],
      },
    ]);

    expect(snapshot.step_cmd).toHaveLength(1);
    const cmd = snapshot.step_cmd[0];
    expect(cmd.command).toBe("npm test");
    expect(cmd.command_id).toBe("cmd-npm-test");
    expect(cmd.status).toBe("success");
    expect(cmd.outcome).toBe("テスト成功");

    expect(snapshot.step_blocker).toHaveLength(1);
    expect(snapshot.step_blocker[0]).toEqual({
      scope: "general",
      tag: "need_replan",
      reason: "タスクが大きすぎる",
    });

    expect(snapshot.step_intent).toEqual({
      intent: "implement",
      requirement_ids: ["R1", "R2"],
      summary: "auth flow を修正した",
    });

    expect(snapshot.step_verify).toEqual({
      status: "ready",
      command_ids: ["cmd-npm-test"],
      summary: "テスト根拠が揃った",
    });

    expect(snapshot.step_audit).toEqual({
      status: "ready",
      requirement_ids: ["R1", "R2"],
    });

    expect(snapshot.raw_stdout).toBe(stdout);
  });

  it("also accepts legacy ASCII arrows in STEP_TODO transitions", () => {
    const snapshot = parseExecutorStepSnapshot(
      "STEP_TODO: T2 R7 migrate flow (pending->in_progress)",
      "sess-legacy",
      4,
    );

    expect(snapshot.step_todo[0]).toMatchObject({
      id: "T2",
      from: "pending",
      to: "in_progress",
    });
  });

  it("ignores malformed STEP_INTENT, STEP_VERIFY, and STEP_AUDIT status tokens", () => {
    const snapshot = parseExecutorStepSnapshot(
      [
        "STEP_INTENT: impl R1 malformed",
        "STEP_VERIFY: rdy cmd-npm-test malformed",
        "STEP_AUDIT: done R1",
      ].join("\n"),
      "sess-bad",
      5,
    );

    expect(snapshot.step_intent).toBeUndefined();
    expect(snapshot.step_verify).toBeUndefined();
    expect(snapshot.step_audit).toBeUndefined();
  });

  it("accepts comma-space separated ids in STEP_INTENT and STEP_VERIFY", () => {
    const snapshot = parseExecutorStepSnapshot(
      [
        "STEP_INTENT: implement R1, R2 auth flow を修正した",
        "STEP_VERIFY: ready cmd-a, cmd-b テスト根拠が揃った",
      ].join("\n"),
      "sess-comma-space",
      6,
    );

    expect(snapshot.step_intent).toEqual({
      intent: "implement",
      requirement_ids: ["R1", "R2"],
      summary: "auth flow を修正した",
    });
    expect(snapshot.step_verify).toEqual({
      status: "ready",
      command_ids: ["cmd-a", "cmd-b"],
      summary: "テスト根拠が揃った",
    });
  });
});

describe("getExecutorVerificationEvidence", () => {
  it("accepts diff-only verification when STEP_VERIFY is ready", () => {
    const snapshot = parseExecutorStepSnapshot(
      [
        "STEP_DIFF: agents/orch-executor.md tighten verification gate",
        "STEP_VERIFY: ready - diff evidence re-checked",
      ].join("\n"),
      "sess-diff",
      7,
    );

    expect(getExecutorVerificationEvidence(snapshot)).toEqual({
      hasEvidence: true,
      reason: "diffs",
    });
  });

  it("accepts explicit no-command reasons when no command ids are present", () => {
    const snapshot = parseExecutorStepSnapshot(
      "STEP_VERIFY: ready - no-command prompt-only wording was re-checked locally",
      "sess-no-command",
      8,
    );

    expect(getExecutorVerificationEvidence(snapshot)).toEqual({
      hasEvidence: true,
      reason: "no_command_reason",
    });
  });
});

describe("buildRequirementDiffTrace", () => {
  it("falls back to intent/audit requirement ids when no STEP_TODO lines exist", () => {
    const trace = buildRequirementDiffTrace({
      step_todo: [],
      step_diff: [
        { path: "src/orchestrator-loop.ts", summary: "log traceability" },
      ],
      step_intent: {
        intent: "implement",
        requirement_ids: ["R6", "R8"],
        summary: "traceability and regression evidence",
      },
      step_audit: {
        status: "in_progress",
        requirement_ids: ["R8"],
      },
    });

    expect(trace).toEqual([
      {
        requirement_id: "R6",
        representative_files: ["src/orchestrator-loop.ts"],
      },
      {
        requirement_id: "R8",
        representative_files: ["src/orchestrator-loop.ts"],
      },
    ]);
  });
});

describe("loadStatusJson / saveStatusJson", () => {
  it("round-trips a simple status object", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-status-"));
    const statusPath = path.join(tmpDir, "status.json");

    const status: OrchestratorStatus = {
      version: 1,
      last_session_id: "sess-test",
      current_cycle: 2,
      replan_required: true,
      replan_reason: "general: need more info",
      replan_request: {
        requested_at_cycle: 2,
        issues: [
          {
            source: "executor",
            summary: "need more info",
            related_todo_ids: [],
            related_requirement_ids: [],
          },
        ],
      },
      consecutive_env_blocked: 1,
      failure_budget: {
        todo_writer_safety_restarts: 0,
        executor_safety_restarts: 1,
        consecutive_env_blocked: 1,
        consecutive_audit_failures: 2,
        consecutive_verification_gaps: 1,
        consecutive_contract_gaps: 1,
        last_failure_kind: "audit_failed",
        last_failure_summary: "missing docs",
      },
      proposals: [],
    };

    saveStatusJson(statusPath, status);

    const loaded = loadStatusJson(statusPath);
    expect(loaded.version).toBe(1);
    expect(loaded.last_session_id).toBe("sess-test");
    expect(loaded.current_cycle).toBe(2);
    expect(loaded.replan_required).toBe(true);
    expect(loaded.replan_reason).toBe("general: need more info");
    expect(loaded.replan_request).toEqual({
      requested_at_cycle: 2,
      issues: [
        {
          source: "executor",
          summary: "need more info",
          related_todo_ids: [],
          related_requirement_ids: [],
        },
      ],
    });
    expect(loaded.consecutive_env_blocked).toBe(1);
    expect(loaded.failure_budget).toEqual({
      todo_writer_safety_restarts: 0,
      executor_safety_restarts: 1,
      consecutive_env_blocked: 1,
      consecutive_audit_failures: 2,
      consecutive_verification_gaps: 1,
      consecutive_contract_gaps: 1,
      last_failure_kind: "audit_failed",
      last_failure_summary: "missing docs",
    });
  });

  it("returns default status when file is missing or invalid", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-status-"));
    const missingPath = path.join(tmpDir, "missing-status.json");
    const missing = loadStatusJson(missingPath);
    expect(missing).toEqual({ version: 1 });

    const invalidPath = path.join(tmpDir, "invalid-status.json");
    fs.writeFileSync(invalidPath, "not-json", "utf8");
    const invalid = loadStatusJson(invalidPath);
    expect(invalid).toEqual({ version: 1 });

    const wrongVersionPath = path.join(tmpDir, "wrong-version.json");
    fs.writeFileSync(
      wrongVersionPath,
      JSON.stringify({ version: 999, last_session_id: "x" }),
      "utf8",
    );
    const wrongVersion = loadStatusJson(wrongVersionPath);
    expect(wrongVersion).toEqual({ version: 1 });
  });
});

describe("buildReplanRequest", () => {
  it("normalizes executor blockers and auditor failures into one request", () => {
    const executorStep = parseExecutorStepSnapshot(
      [
        "STEP_BLOCKER: general need_replan タスクが大きすぎる",
        "STEP_BLOCKER: T4-auth need_replan 認証周りを分割したい",
        "STEP_INTENT: replan R3-auth,R4-ui 要件単位で再計画したい",
        "STEP_AUDIT: in_progress R3-auth,R4-ui",
      ].join("\n"),
      "sess-1",
      7,
    );

    const request = buildReplanRequest(7, executorStep, {
      cycle: 6,
      done: false,
      requirements: [
        {
          id: "R3-auth",
          passed: false,
          reason: "認証要件の証拠が不足している",
        },
        { id: "R4-ui", passed: true },
      ],
    });

    expect(request).toEqual({
      requested_at_cycle: 7,
      issues: [
        {
          source: "executor",
          summary: "タスクが大きすぎる",
          related_todo_ids: [],
          related_requirement_ids: ["R3-auth", "R4-ui"],
        },
        {
          source: "executor",
          summary: "認証周りを分割したい",
          related_todo_ids: ["T4-auth"],
          related_requirement_ids: ["R3-auth", "R4-ui"],
        },
        {
          source: "auditor",
          summary: "認証要件の証拠が不足している",
          related_todo_ids: [],
          related_requirement_ids: ["R3-auth"],
        },
      ],
    });
  });
});
