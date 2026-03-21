import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import type { LoopOptions } from "../src/cli-args.js";
import { runOpencode } from "../src/orchestrator-process.js";
import type { OrchestratorStatus } from "../src/orchestrator-status.js";
import {
  maybeRunTodoWriterStep,
  runExecutorAndAuditorStep,
  type TodoWriterStepResult,
  type ExecutorAuditorStepResult,
} from "../src/orchestrator-steps.js";

vi.mock("../src/orchestrator-process.js", () => ({
  runOpencode: vi.fn(),
}));

const mockRunOpencode = runOpencode as unknown as ReturnType<typeof vi.fn>;

const baseOpts: LoopOptions = {
  task: "test-task",
  maxLoop: 10,
  maxRestarts: 2,
  files: [],
  prompt: "test",
  sessionId: undefined,
  continueLast: false,
  commitOnDone: false,
};

function createStatus(): OrchestratorStatus {
  return {
    version: 1,
    last_session_id: "sess-1",
    consecutive_env_blocked: 0,
  };
}

describe("maybeRunTodoWriterStep", () => {
  beforeEach(() => {
    mockRunOpencode.mockReset();
  });

  it("skips when no acceptance-index.json and returns unchanged state", async () => {
    const status = createStatus();
    const res: TodoWriterStepResult = await maybeRunTodoWriterStep(
      baseOpts,
      1,
      "001",
      "/tmp/state",
      "/tmp/logs",
      path.join("/tmp/state", "missing-acceptance-index.json"),
      "sess-1",
      [],
      status,
      "/tmp/state/status.json",
      0,
      false,
    );

    expect(res.sessionId).toBe("sess-1");
    expect(res.restartCount).toBe(0);
    expect(res.forceTodoWriterNextStep).toBe(false);
    expect(res.restartedSession).toBe(false);
    expect(res.abortLoop).toBe(false);
  });

  it("sets abortLoop when safety trip and max restarts reached", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-"),
    );
    const tmpLogs = fs.mkdtempSync(path.join(os.tmpdir(), "orch-steps-logs-"));
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");
    const stdout =
      "I'm sorry, but I can't assist with that request.\n" +
      "STEP_TODO: T1 - dummy";
    mockRunOpencode.mockResolvedValue({ code: 0, stdout } as any);

    const res = await maybeRunTodoWriterStep(
      baseOpts,
      1,
      "001",
      tmpState,
      tmpLogs,
      acceptancePath,
      "sess-1",
      [],
      status,
      path.join(tmpState, "status.json"),
      baseOpts.maxRestarts, // すでに上限に達しているとみなす
      false,
    );

    expect(res.abortLoop).toBe(true);
    expect(res.restartedSession).toBe(false);
  });
});

describe("runExecutorAndAuditorStep", () => {
  beforeEach(() => {
    mockRunOpencode.mockReset();
  });

  it("aborts loop when executor safety trip and max restarts reached", async () => {
    const status = createStatus();
    const stdout =
      "I'm sorry, but I can't assist with that request.\n" +
      "STEP_TODO: T1 - dummy";
    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout } as any);

    const res: ExecutorAuditorStepResult = await runExecutorAndAuditorStep(
      baseOpts,
      1,
      "sess-1",
      [],
      "/tmp/logs/orch_step_001.txt",
      "/tmp/logs/audit_step_001.jsonl",
      status,
      "/tmp/state/status.json",
      baseOpts.maxRestarts, // 既に上限
      false,
      "/tmp/logs",
    );

    expect(res.abortLoop).toBe(true);
    expect(res.skipAuditorThisStep).toBe(false);
    expect(res.done).toBe(false);
  });

  it("requests replanning when STEP_BLOCKER general need_replan appears", async () => {
    const status = createStatus();
    const stdout = [
      "STEP_TODO: T1 R1 do something",
      "STEP_BLOCKER: general need_replan 粒度が大きすぎる",
    ].join("\n");

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout } as any);
    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: "{}",
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      1,
      "sess-1",
      [],
      "/tmp/logs/orch_step_001.txt",
      "/tmp/logs/audit_step_001.jsonl",
      status,
      "/tmp/state/status.json",
      0,
      false,
      "/tmp/logs",
    );

    expect(res.forceTodoWriterNextStep).toBe(true);
    expect(status.replan_required).toBe(true);
    // replan_reason は `<scope>: <reason>` 形式で保存される
    expect(status.replan_reason).toBe("general: 粒度が大きすぎる");
  });

  it("invokes auditor when STEP_AUDIT ready and propagates done + report", async () => {
    const status = createStatus();

    const execStdout = [
      "STEP_TODO: T1 R1,R2 do something",
      "STEP_AUDIT: ready R1,R2",
    ].join("\n");

    const auditPayload = {
      done: true,
      requirements: [
        { id: "R1", passed: true },
        { id: "R2", passed: false, reason: "missing docs" },
      ],
    };
    const auditStdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify(auditPayload),
      },
    });

    mockRunOpencode
      .mockResolvedValueOnce({ code: 0, stdout: execStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: auditStdout } as any)
      // findSessionIdByTitle (session list)
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      3,
      "sess-1",
      [],
      "/tmp/logs/orch_step_003.txt",
      "/tmp/logs/audit_step_003.jsonl",
      status,
      "/tmp/state/status.json",
      0,
      false,
      "/tmp/logs",
    );

    expect(res.done).toBe(true);
    expect(res.abortLoop).toBe(false);
    expect(res.skipAuditorThisStep).toBe(false);

    expect(status.last_auditor_report).toBeDefined();
    expect(status.last_auditor_report?.cycle).toBe(3);
    expect(status.last_auditor_report?.done).toBe(true);
    expect(status.last_auditor_report?.requirements).toHaveLength(2);
    const [r1, r2] = status.last_auditor_report!.requirements;
    // Executor 実行 + Auditor 実行 + session list の 3 回呼ばれていることを確認
    expect(mockRunOpencode).toHaveBeenCalledTimes(3);

    const execCallArgs = mockRunOpencode.mock.calls[0][0] as string[];
    const auditCallArgs = mockRunOpencode.mock.calls[1][0] as string[];

    // Executor はメインセッションを共有している
    expect(execCallArgs).toContain("--session");
    expect(execCallArgs).toContain("sess-1");

    // Auditor は --session を使わず、--title で専用セッションを作る
    expect(auditCallArgs).not.toContain("--session");
    expect(auditCallArgs).toContain("--title");

    // 順序は失敗→成功の順で入るので、R2 が failed, R1 が passed になっていることを確認
    expect(r1).toMatchObject({ id: "R2", passed: false });
    expect(r2).toMatchObject({ id: "R1", passed: true });
  });

  it("skips auditor when no STEP_AUDIT ready is reported", async () => {
    const status = createStatus();

    const execStdout = "STEP_TODO: T1 R1 do something";
    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: execStdout,
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      4,
      "sess-1",
      [],
      "/tmp/logs/orch_step_004.txt",
      "/tmp/logs/audit_step_004.jsonl",
      status,
      "/tmp/state/status.json",
      0,
      false,
      "/tmp/logs",
    );

    expect(mockRunOpencode).toHaveBeenCalledTimes(1);
    expect(res.done).toBe(false);
    expect(status.last_auditor_report).toBeUndefined();
  });

  it("attaches status.json to executor call immediately after an auditor cycle", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-status-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    // Simulate that an auditor ran on cycle 4 and reported not done yet.
    status.last_auditor_report = {
      cycle: 4,
      done: false,
      requirements: [],
    };

    const execStdout = "STEP_TODO: T1 R1 do something";
    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: execStdout,
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      5, // current step is last_auditor_report.cycle + 1
      "sess-1",
      [],
      "/tmp/logs/orch_step_005.txt",
      "/tmp/logs/audit_step_005.jsonl",
      status,
      statusPath,
      0,
      false,
      "/tmp/logs",
    );

    expect(mockRunOpencode).toHaveBeenCalledTimes(1);
    expect(res.done).toBe(false);

    const execCallArgs = mockRunOpencode.mock.calls[0][0] as string[];
    // Executor call should receive status.json via --file arguments.
    expect(execCallArgs).toContain("--file");
    expect(execCallArgs).toContain(statusPath);
  });

  it("does not attach status.json when last_auditor_report is done", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-status-done-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    status.last_auditor_report = {
      cycle: 4,
      done: true,
      requirements: [],
    };

    const execStdout = "STEP_TODO: T1 R1 do something";
    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: execStdout,
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      5,
      "sess-1",
      [],
      "/tmp/logs/orch_step_005.txt",
      "/tmp/logs/audit_step_005.jsonl",
      status,
      statusPath,
      0,
      false,
      "/tmp/logs",
    );

    expect(mockRunOpencode).toHaveBeenCalledTimes(1);
    expect(res.done).toBe(false);

    const execCallArgs = mockRunOpencode.mock.calls[0][0] as string[];
    expect(execCallArgs).not.toContain(statusPath);
  });

  it("aborts loop when proposals are already present in status", async () => {
    const status: OrchestratorStatus = {
      ...createStatus(),
      proposals: [
        {
          id: "p-1",
          source: "executor",
          cycle: 1,
          kind: "env_blocked",
          summary: "env blocked",
          details: "missing tool",
        } as any,
      ],
    };

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout: "" } as any);

    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-proposals-"),
    );

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      5,
      "sess-1",
      [],
      "/tmp/logs/orch_step_005.txt",
      "/tmp/logs/audit_step_005.jsonl",
      status,
      path.join(tmpState, "status.json"),
      0,
      false,
      "/tmp/logs",
    );

    expect(res.abortLoop).toBe(true);
    expect(res.skipAuditorThisStep).toBe(false);
    expect(res.done).toBe(false);
  });
});
