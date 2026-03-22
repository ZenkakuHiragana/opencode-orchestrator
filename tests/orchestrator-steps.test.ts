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
    const statusPath = path.join(tmpState, "status.json");
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
      statusPath,
      baseOpts.maxRestarts, // すでに上限に達しているとみなす
      false,
    );

    expect(res.abortLoop).toBe(true);
    expect(res.restartedSession).toBe(false);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      todo_writer_safety_restarts: 1,
      last_failure_kind: "todo_writer_safety",
    });
  });

  it("clears replan metadata after todo-writer consumes a replanning step", async () => {
    const status: OrchestratorStatus = {
      ...createStatus(),
      replan_required: true,
      replan_reason: "general: 粒度を分割したい",
      replan_request: {
        requested_at_cycle: 3,
        issues: [
          {
            source: "executor",
            summary: "粒度を分割したい",
            related_todo_ids: [],
            related_requirement_ids: [],
          },
        ],
      },
    };
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-replan-clear-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-replan-clear-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const todoPath = path.join(tmpState, "todo.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");
    fs.writeFileSync(todoPath, JSON.stringify({ todos: [] }), "utf8");

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout: "" } as any);

    const res = await maybeRunTodoWriterStep(
      baseOpts,
      2,
      "002",
      tmpState,
      tmpLogs,
      acceptancePath,
      "sess-1",
      [],
      status,
      path.join(tmpState, "status.json"),
      0,
      false,
    );

    expect(res.abortLoop).toBe(false);
    expect(status.replan_required).toBe(false);
    expect(status.replan_reason).toBeNull();
    expect(status.replan_request).toBeNull();
  });

  it("preserves replan metadata and retries when todo-writer exits non-zero", async () => {
    const status: OrchestratorStatus = {
      ...createStatus(),
      replan_required: true,
      replan_reason: "general: 粒度を分割したい",
      replan_request: {
        requested_at_cycle: 3,
        issues: [
          {
            source: "executor",
            summary: "粒度を分割したい",
            related_todo_ids: [],
            related_requirement_ids: [],
          },
        ],
      },
    };
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-replan-preserve-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-replan-preserve-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");

    mockRunOpencode.mockResolvedValueOnce({
      code: 1,
      stdout: "planner failed",
    } as any);

    const res = await maybeRunTodoWriterStep(
      baseOpts,
      2,
      "002",
      tmpState,
      tmpLogs,
      acceptancePath,
      "sess-1",
      [],
      status,
      statusPath,
      0,
      false,
    );

    expect(res.abortLoop).toBe(false);
    expect(res.forceTodoWriterNextStep).toBe(true);
    expect(status.replan_required).toBe(true);
    expect(status.replan_reason).toBe("general: 粒度を分割したい");
    expect(status.replan_request).toEqual({
      requested_at_cycle: 3,
      issues: [
        {
          source: "executor",
          summary: "粒度を分割したい",
          related_todo_ids: [],
          related_requirement_ids: [],
        },
      ],
    });

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      last_failure_kind: "todo_writer_failed",
      last_failure_summary:
        "todo-writer が non-zero exit を返したため再計画状態を維持する",
    });
    expect(saved.replan_required).toBe(true);
    expect(saved.replan_reason).toBe("general: 粒度を分割したい");
  });

  it("attaches status.json to todo-writer replans with its own --file flag", async () => {
    const status: OrchestratorStatus = {
      ...createStatus(),
      replan_required: true,
    };
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-todowriter-files-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-todowriter-files-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout: "" } as any);

    await maybeRunTodoWriterStep(
      baseOpts,
      2,
      "002",
      tmpState,
      tmpLogs,
      acceptancePath,
      "sess-1",
      ["--file", "spec.md"],
      status,
      statusPath,
      0,
      false,
    );

    const todoWriterArgs = mockRunOpencode.mock.calls[0][0] as string[];
    expect(todoWriterArgs).toEqual([
      "run",
      "--command",
      "orch-todo-write",
      "--session",
      "sess-1",
      "--file",
      "spec.md",
      "--file",
      statusPath,
      "--",
      "",
    ]);
  });

  it("keeps replanning active when todo-writer leaves no valid todo.json", async () => {
    const status: OrchestratorStatus = {
      ...createStatus(),
      replan_required: true,
      replan_reason: "general: 既存todoを再構築したい",
    };
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-invalid-todo-cache-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-invalid-todo-cache-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout: "" } as any);

    const res = await maybeRunTodoWriterStep(
      baseOpts,
      2,
      "002",
      tmpState,
      tmpLogs,
      acceptancePath,
      "sess-1",
      [],
      status,
      statusPath,
      0,
      false,
    );

    expect(res.abortLoop).toBe(false);
    expect(res.forceTodoWriterNextStep).toBe(true);
    expect(status.replan_required).toBe(true);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      last_failure_kind: "todo_writer_invalid_todo_cache",
      last_failure_summary:
        "todo-writer が有効な todo.json を残さなかったため再計画状態を維持する",
    });
  });
});

describe("runExecutorAndAuditorStep", () => {
  beforeEach(() => {
    mockRunOpencode.mockReset();
  });

  it("aborts loop when executor safety trip and max restarts reached", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-executor-abort-"),
    );
    const statusPath = path.join(tmpState, "status.json");
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
      statusPath,
      baseOpts.maxRestarts, // 既に上限
      false,
      "/tmp/logs",
    );

    expect(res.abortLoop).toBe(true);
    expect(res.skipAuditorThisStep).toBe(false);
    expect(res.done).toBe(false);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      executor_safety_restarts: 1,
      last_failure_kind: "executor_safety",
    });
  });

  it("requests replanning when STEP_BLOCKER general need_replan appears", async () => {
    const status = createStatus();
    const stdout = [
      "STEP_TODO: T1 R1 do something",
      "STEP_INTENT: replan R1 粒度の見直しが必要",
      "STEP_VERIFY: not_ready - まだ監査準備ではない",
      "STEP_BLOCKER: general need_replan 粒度が大きすぎる",
      "STEP_AUDIT: in_progress R1",
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
    expect(status.replan_request).toEqual({
      requested_at_cycle: 1,
      issues: [
        {
          source: "executor",
          summary: "粒度が大きすぎる",
          related_todo_ids: [],
          related_requirement_ids: ["R1"],
        },
      ],
    });
  });

  it("invokes auditor when STEP_AUDIT ready and propagates done + report", async () => {
    const status = createStatus();

    const execStdout = [
      "STEP_TODO: T1 R1,R2 do something",
      "STEP_INTENT: verify R1,R2 監査前の仕上げを行った",
      "STEP_VERIFY: ready cmd-npm-test 監査に必要な根拠が揃った",
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

  it("merges auditor failures into replan_request when replanning is already required", async () => {
    const status = createStatus();
    const execStdout = [
      "STEP_BLOCKER: T4-auth need_replan 認証todoを分割したい",
      "STEP_INTENT: replan R3-auth 監査で失敗した認証要件を再整理したい",
      "STEP_VERIFY: ready cmd-auth-test 認証の検証は実行済み",
      "STEP_AUDIT: ready R3-auth",
    ].join("\n");

    const auditPayload = {
      done: false,
      requirements: [
        { id: "R3-auth", passed: false, reason: "認証の受け入れ条件が未達" },
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
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any);

    await runExecutorAndAuditorStep(
      baseOpts,
      6,
      "sess-1",
      [],
      "/tmp/logs/orch_step_006.txt",
      "/tmp/logs/audit_step_006.jsonl",
      status,
      "/tmp/state/status.json",
      0,
      false,
      "/tmp/logs",
    );

    expect(status.replan_required).toBe(true);
    expect(status.replan_request).toEqual({
      requested_at_cycle: 6,
      issues: [
        {
          source: "executor",
          summary: "認証todoを分割したい",
          related_todo_ids: ["T4-auth"],
          related_requirement_ids: ["R3-auth"],
        },
        {
          source: "auditor",
          summary: "認証の受け入れ条件が未達",
          related_todo_ids: [],
          related_requirement_ids: ["R3-auth"],
        },
      ],
    });
  });

  it("skips auditor when no STEP_AUDIT ready is reported", async () => {
    const status = createStatus();

    const execStdout = [
      "STEP_TODO: T1 R1 do something",
      "STEP_INTENT: implement R1 機能追加を進めた",
      "STEP_VERIFY: not_ready - まだ監査根拠が不足している",
      "STEP_AUDIT: in_progress R1",
    ].join("\n");
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

    const execStdout = [
      "STEP_TODO: T1 R1 do something",
      "STEP_INTENT: implement R1 監査結果に対応した",
      "STEP_VERIFY: not_ready - 監査の追跡を続ける",
      "STEP_AUDIT: in_progress R1",
    ].join("\n");
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

    const execStdout = [
      "STEP_TODO: T1 R1 do something",
      "STEP_INTENT: implement R1 通常実装を進めた",
      "STEP_VERIFY: not_ready - まだ監査対象ではない",
      "STEP_AUDIT: in_progress R1",
    ].join("\n");
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

  it("skips auditor and records verification gap when audit is requested without STEP_VERIFY ready", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-verification-gap-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    const execStdout = [
      "STEP_INTENT: verify R4-ui 監査に出したい UI 修正をまとめた",
      "STEP_VERIFY: not_ready - 根拠の整理がまだ不足している",
      "STEP_AUDIT: ready R4-ui",
    ].join("\n");

    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: execStdout,
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      8,
      "sess-1",
      [],
      "/tmp/logs/orch_step_008.txt",
      "/tmp/logs/audit_step_008.jsonl",
      status,
      statusPath,
      0,
      false,
      "/tmp/logs",
    );

    expect(res.done).toBe(false);
    expect(mockRunOpencode).toHaveBeenCalledTimes(1);
    expect(status.failure_budget?.consecutive_verification_gaps).toBe(1);
    expect(status.replan_request).toEqual({
      requested_at_cycle: 8,
      issues: [
        {
          source: "executor",
          summary:
            "監査準備を宣言したが自己検証の根拠が不足している。STEP_VERIFY に command id・差分確認・no-command 理由を結び付け、必要なら todo を監査証拠単位で再分解したい (command id・差分確認・no-command 理由のいずれかを明示したい)",
          related_todo_ids: [],
          related_requirement_ids: ["R4-ui"],
        },
      ],
    });
  });

  it("resets verification-gap budget after a clean non-audit-ready step", async () => {
    const status = createStatus();
    status.failure_budget = {
      todo_writer_safety_restarts: 0,
      executor_safety_restarts: 0,
      consecutive_env_blocked: 0,
      consecutive_audit_failures: 0,
      consecutive_verification_gaps: 1,
      consecutive_contract_gaps: 0,
    };
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-verification-gap-reset-"),
    );

    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: [
        "STEP_INTENT: implement R5 次の実装ステップを進めた",
        "STEP_VERIFY: not_ready - まだ監査対象ではない",
        "STEP_AUDIT: in_progress R5",
      ].join("\n"),
    } as any);

    await runExecutorAndAuditorStep(
      baseOpts,
      12,
      "sess-1",
      [],
      "/tmp/logs/orch_step_012.txt",
      "/tmp/logs/audit_step_012.jsonl",
      status,
      path.join(tmpState, "status.json"),
      0,
      false,
      "/tmp/logs",
    );

    expect(status.failure_budget?.consecutive_verification_gaps).toBe(0);
  });

  it("records a contract gap when executor omits STEP_INTENT and STEP_VERIFY", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-contract-gap-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: "STEP_AUDIT: in_progress R9",
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      9,
      "sess-1",
      [],
      "/tmp/logs/orch_step_009.txt",
      "/tmp/logs/audit_step_009.jsonl",
      status,
      statusPath,
      0,
      false,
      "/tmp/logs",
    );

    expect(res.done).toBe(false);
    expect(status.failure_budget?.consecutive_contract_gaps).toBe(1);
    expect(status.replan_request).toEqual({
      requested_at_cycle: 9,
      issues: [
        {
          source: "executor",
          summary:
            "executor の出力が不足している。各 step で STEP_INTENT と STEP_VERIFY を必ず出力できるように todo と検証境界を明確にしたい",
          related_todo_ids: [],
          related_requirement_ids: ["R9"],
        },
      ],
    });
  });

  it("treats malformed STEP_INTENT and STEP_VERIFY values as a contract gap", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-malformed-protocol-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: [
        "STEP_INTENT: impl R9 malformed",
        "STEP_VERIFY: rdy cmd-npm-test malformed",
        "STEP_AUDIT: in_progress R9",
      ].join("\n"),
    } as any);

    await runExecutorAndAuditorStep(
      baseOpts,
      11,
      "sess-1",
      [],
      "/tmp/logs/orch_step_011.txt",
      "/tmp/logs/audit_step_011.jsonl",
      status,
      statusPath,
      0,
      false,
      "/tmp/logs",
    );

    expect(status.failure_budget?.consecutive_contract_gaps).toBe(1);
    expect(status.replan_request).toEqual({
      requested_at_cycle: 11,
      issues: [
        {
          source: "executor",
          summary:
            "executor の出力が不足している。各 step で STEP_INTENT と STEP_VERIFY を必ず出力できるように todo と検証境界を明確にしたい",
          related_todo_ids: [],
          related_requirement_ids: ["R9"],
        },
      ],
    });
  });

  it("persists failure budget when executor restart cannot locate a new session", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-restart-failure-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    mockRunOpencode
      .mockResolvedValueOnce({
        code: 0,
        stdout:
          "I'm sorry, but I can't assist with that request.\nSTEP_TODO: T1 - dummy",
      } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "{}" } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "{}" } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      10,
      "sess-1",
      [],
      "/tmp/logs/orch_step_010.txt",
      "/tmp/logs/audit_step_010.jsonl",
      status,
      statusPath,
      0,
      false,
      "/tmp/logs",
    );

    expect(res.abortLoop).toBe(false);
    expect(res.skipAuditorThisStep).toBe(true);
    expect(res.sessionId).toBe("sess-1");

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      executor_safety_restarts: 1,
      last_failure_kind: "executor_safety",
    });
  });
});
