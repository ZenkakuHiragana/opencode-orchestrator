import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildReplanRequest,
  parseExecutorStepSnapshot,
  loadStatusJson,
  saveStatusJson,
  type OrchestratorStatus,
} from "../src/orchestrator-status.js";

describe("parseExecutorStepSnapshot", () => {
  it("parses STEP_* lines into a structured snapshot", () => {
    const stdout = [
      "STEP_TODO: T1 R1,R2 implement feature (pending->completed)",
      "STEP_DIFF: src/foo.ts added endpoint",
      "STEP_CMD: npm test (cmd-npm-test) success テスト成功",
      "STEP_BLOCKER: general need_replan タスクが大きすぎる",
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
    expect(todo.description).toBe("implement feature");
    expect(todo.from).toBe("pending");
    expect(todo.to).toBe("completed");

    expect(snapshot.step_diff).toHaveLength(1);
    expect(snapshot.step_diff[0]).toEqual({
      path: "src/foo.ts",
      summary: "added endpoint",
    });

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

    expect(snapshot.step_audit).toEqual({
      status: "ready",
      requirement_ids: ["R1", "R2"],
    });

    expect(snapshot.raw_stdout).toBe(stdout);
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
      ].join("\n"),
      "sess-1",
      7,
    );

    const request = buildReplanRequest(7, executorStep, {
      cycle: 6,
      done: false,
      requirements: [
        { id: "R3-auth", passed: false, reason: "認証要件の証拠が不足している" },
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
          related_requirement_ids: [],
        },
        {
          source: "executor",
          summary: "認証周りを分割したい",
          related_todo_ids: ["T4-auth"],
          related_requirement_ids: [],
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
