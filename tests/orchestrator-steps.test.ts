import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { LoopOptions } from "../src/cli-args.js";
import { runOpencode } from "../src/orchestrator-process.js";
import type { OrchestratorStatus } from "../src/orchestrator-status.js";
import {
  maybeRunTodoWriterStep,
  runExecutorAndAuditorStep,
  type TodoWriterStepResult,
  type ExecutorAuditorStepResult,
} from "../src/orchestrator-steps.js";
import { loadProposals } from "../src/orchestrator-proposals.js";

vi.mock("../src/orchestrator-process.js", () => ({
  runOpencode: vi.fn(),
}));

const mockRunOpencode = runOpencode as unknown as ReturnType<typeof vi.fn>;

let sharedStateDir = "";
let sharedLogsDir = "";

function setupSharedStepDirs(): void {
  sharedStateDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "orch-steps-state-shared-"),
  );
  sharedLogsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "orch-steps-logs-shared-"),
  );
}

function cleanupSharedStepDirs(): void {
  fs.rmSync(sharedStateDir, { recursive: true, force: true });
  fs.rmSync(sharedLogsDir, { recursive: true, force: true });
  sharedStateDir = "";
  sharedLogsDir = "";
}

function stepLogPath(step: number): string {
  return path.join(
    sharedLogsDir,
    `orch_step_${String(step).padStart(3, "0")}.txt`,
  );
}

function auditLogPath(step: number): string {
  return path.join(
    sharedLogsDir,
    `audit_step_${String(step).padStart(3, "0")}.jsonl`,
  );
}

function sharedStatusPath(): string {
  return path.join(sharedStateDir, "status.json");
}

function sharedProposalsPath(): string {
  return path.join(sharedStateDir, "proposals.json");
}

beforeEach(() => {
  setupSharedStepDirs();
});

afterEach(() => {
  cleanupSharedStepDirs();
});

const baseOpts: LoopOptions = {
  task: "test-task",
  maxLoop: 10,
  maxRestarts: 2,
  files: [],
  prompt: "test",
  sessionId: undefined,
  continueLast: false,
  commitOnDone: false,
  dangerouslySkipCommandPolicy: false,
  bwrapSkipCommandPolicy: false,
  bwrapArgs: [],
};

function createStatus(): OrchestratorStatus {
  return {
    version: 1,
    last_session_id: "sess-1",
    consecutive_env_blocked: 0,
  };
}

function writeProposalsJson(
  dir: string,
  proposals: Array<{
    id: string;
    source: "executor" | "auditor" | "todo_writer";
    cycle: number;
    kind: string;
    priority: "low" | "medium" | "high" | "critical";
    summary: string;
    details?: string;
    related_requirement_ids: string[];
    related_todo_ids: string[];
    status: "open" | "resolved" | "dismissed";
    auto_resolvable: boolean;
    created_at: string;
    resolved_at?: string;
    resolved_by?: "cli" | "planner" | "todo_writer" | "auto";
  }>,
): void {
  fs.writeFileSync(
    path.join(dir, "proposals.json"),
    JSON.stringify({ version: 1, proposals }, null, 2),
    "utf8",
  );
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
      sharedStateDir,
      sharedLogsDir,
      path.join(sharedStateDir, "missing-acceptance-index.json"),
      "sess-1",
      [],
      status,
      sharedStatusPath(),
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
    const stdout = "I'm sorry, but I cannot assist with that request.";
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

  it("resolves open auto-resolvable proposals after todo-writer success", async () => {
    const status = createStatus();
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
    writeProposalsJson(tmpState, [
      {
        id: "p-1",
        source: "executor",
        cycle: 3,
        kind: "need_replan",
        priority: "high",
        summary: "粒度を分割したい",
        related_todo_ids: [],
        related_requirement_ids: [],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
    ]);

    mockRunOpencode.mockImplementationOnce(async () => {
      // Simulate Todo-Writer writing a new todo.json so that the replan is
      // considered meaningful (non no-op) by the orchestrator. This ensures
      // auto-resolvable proposals are eligible to be resolved.
      fs.writeFileSync(
        todoPath,
        JSON.stringify(
          {
            todos: [
              {
                id: "T1",
                summary: "replanned",
                status: "pending",
                related_requirement_ids: [],
              },
            ],
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      return { code: 0, stdout: "" } as any;
    });

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
    const proposals = loadProposals(path.join(tmpState, "proposals.json"));
    expect(proposals.proposals[0]?.status).toBe("resolved");
    expect(proposals.proposals[0]?.resolved_by).toBe("auto");
    expect(proposals.proposals[0]?.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("leaves non-auto-resolvable proposals open after todo-writer success", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-replan-preserve-open-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-replan-preserve-open-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const todoPath = path.join(tmpState, "todo.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");
    fs.writeFileSync(todoPath, JSON.stringify({ todos: [] }), "utf8");
    writeProposalsJson(tmpState, [
      {
        id: "p-open-auto",
        source: "executor",
        cycle: 3,
        kind: "need_replan",
        priority: "high",
        summary: "粒度を分割したい",
        related_todo_ids: [],
        related_requirement_ids: [],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
      {
        id: "p-open-env",
        source: "executor",
        cycle: 3,
        kind: "env_blocked",
        priority: "critical",
        summary: "環境依存の失敗",
        details: "missing tool",
        related_todo_ids: [],
        related_requirement_ids: ["R8"],
        status: "open",
        auto_resolvable: false,
        created_at: "2026-03-29T00:00:00.000Z",
      },
    ]);

    mockRunOpencode.mockImplementationOnce(async () => {
      // Simulate a meaningful todo.json update.
      fs.writeFileSync(
        todoPath,
        JSON.stringify(
          {
            todos: [
              {
                id: "T1",
                summary: "replanned",
                status: "pending",
                related_requirement_ids: [],
              },
            ],
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      return { code: 0, stdout: "" } as any;
    });

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

    const proposals = loadProposals(path.join(tmpState, "proposals.json"));
    expect(
      proposals.proposals.find((p) => p.id === "p-open-auto")?.status,
    ).toBe("resolved");
    expect(proposals.proposals.find((p) => p.id === "p-open-env")?.status).toBe(
      "open",
    );
  });

  it("passes only open proposals into the Todo-Writer prompt", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-prompt-filter-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-prompt-filter-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");
    writeProposalsJson(tmpState, [
      {
        id: "p-open",
        source: "executor",
        cycle: 3,
        kind: "need_replan",
        priority: "high",
        summary: "open summary",
        related_todo_ids: ["T-open"],
        related_requirement_ids: ["R7"],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
      {
        id: "p-resolved",
        source: "auditor",
        cycle: 3,
        kind: "audit_failure",
        priority: "high",
        summary: "resolved summary",
        related_todo_ids: ["T-resolved"],
        related_requirement_ids: ["R19"],
        status: "resolved",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
        resolved_at: "2026-03-29T01:00:00.000Z",
        resolved_by: "auto",
      },
      {
        id: "p-dismissed",
        source: "auditor",
        cycle: 3,
        kind: "audit_failure",
        priority: "high",
        summary: "dismissed summary",
        related_todo_ids: ["T-dismissed"],
        related_requirement_ids: ["R19"],
        status: "dismissed",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
        resolved_at: "2026-03-29T01:00:00.000Z",
        resolved_by: "cli",
      },
    ]);

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout: "" } as any);

    await maybeRunTodoWriterStep(
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

    const todoWriterArgs = mockRunOpencode.mock.calls[0][0] as string[];
    const prompt = todoWriterArgs[todoWriterArgs.length - 1] ?? "";
    expect(prompt).toContain("open summary");
    expect(prompt).not.toContain("resolved summary");
    expect(prompt).not.toContain("dismissed summary");
    expect(prompt).not.toContain("replan_request");
  });

  it("preserves open proposals and retries when todo-writer exits non-zero", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-replan-preserve-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-replan-preserve-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");
    writeProposalsJson(tmpState, [
      {
        id: "p-2",
        source: "executor",
        cycle: 3,
        kind: "need_replan",
        priority: "high",
        summary: "粒度を分割したい",
        related_todo_ids: [],
        related_requirement_ids: [],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
    ]);

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

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      last_failure_kind: "todo_writer_failed",
      last_failure_summary:
        "todo-writer が non-zero exit を返したため再計画状態を維持する",
    });
    const proposals = loadProposals(path.join(tmpState, "proposals.json"));
    expect(proposals.proposals[0]?.status).toBe("open");
  });

  it("attaches status.json to todo-writer replans with its own --file flag", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-todowriter-files-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-todowriter-files-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    const todoPath = path.join(tmpState, "todo.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");
    // Initial todo.json before replan.
    fs.writeFileSync(
      todoPath,
      JSON.stringify({ todos: [] }, null, 2) + "\n",
      "utf8",
    );
    writeProposalsJson(tmpState, [
      {
        id: "p-3",
        source: "executor",
        cycle: 3,
        kind: "need_replan",
        priority: "high",
        summary: "todo-writer に再計画してほしい",
        related_todo_ids: [],
        related_requirement_ids: [],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
    ]);

    mockRunOpencode.mockImplementationOnce(async () => {
      // Simulate Todo-Writer updating todo.json in a meaningful way so that
      // the orchestrator does not treat this as a no-op replan.
      fs.writeFileSync(
        todoPath,
        JSON.stringify(
          {
            todos: [
              {
                id: "T1",
                summary: "replanned",
                status: "pending",
                related_requirement_ids: [],
              },
            ],
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      return { code: 0, stdout: "" } as any;
    });

    const res = await maybeRunTodoWriterStep(
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
    expect(todoWriterArgs.slice(0, 10)).toEqual([
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
    ]);
    expect(todoWriterArgs[10]).toContain("proposals.json");

    // Successful todo-writer runs should not request skipping the executor.
    expect(res.skipExecutorThisStep).toBe(false);
  });

  it("keeps replanning active when todo-writer leaves no valid todo.json", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-invalid-todo-cache-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-invalid-todo-cache-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");
    writeProposalsJson(tmpState, [
      {
        id: "p-4",
        source: "executor",
        cycle: 3,
        kind: "need_replan",
        priority: "high",
        summary: "既存todoを再構築したい",
        related_todo_ids: [],
        related_requirement_ids: [],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
    ]);

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
    expect(res.skipExecutorThisStep).toBe(true);
    expect(res.skipExecutorThisStep).toBe(true);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      last_failure_kind: "todo_writer_invalid_todo_cache",
      last_failure_summary:
        "todo-writer が有効な todo.json を残さなかったため再計画状態を維持する",
    });
  });

  it("skips Executor when todo-writer leaves non-dispatch active todos", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-nondispatch-todos-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-nondispatch-todos-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    const todoPath = path.join(tmpState, "todo.json");
    fs.writeFileSync(
      acceptancePath,
      JSON.stringify({
        version: 1,
        requirements: [{ id: "R1", title: "Requirement 1" }],
      }),
      "utf8",
    );

    mockRunOpencode.mockImplementationOnce(async () => {
      fs.writeFileSync(
        todoPath,
        JSON.stringify(
          {
            todos: [
              {
                id: "T1",
                summary:
                  "Planner-only wait-state coverage until a newly attached packet appears",
                status: "pending",
                related_requirement_ids: ["R1"],
                execution_contract: {
                  intent: "investigate",
                  expected_evidence: [
                    "If no newly attached signal is visible in the current pass, Executor must emit `STEP_BLOCKER` immediately and leave this hold unexecuted.",
                  ],
                },
              },
            ],
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      return { code: 0, stdout: "" } as any;
    });

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
      0,
      false,
    );

    expect(res.abortLoop).toBe(false);
    expect(res.forceTodoWriterNextStep).toBe(true);
    expect(res.skipExecutorThisStep).toBe(true);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.failure_budget).toMatchObject({
      last_failure_kind: "todo_writer_non_dispatch_active_todos",
    });
    expect(saved.failure_budget?.last_failure_summary).toContain(
      "active todos must be executor-runnable",
    );
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
      "I'm sorry, but I cannot assist with that request.\n" +
      "STEP_TODO: T1 - dummy";
    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout } as any);

    const res: ExecutorAuditorStepResult = await runExecutorAndAuditorStep(
      baseOpts,
      1,
      "sess-1",
      [],
      stepLogPath(1),
      auditLogPath(1),
      status,
      statusPath,
      baseOpts.maxRestarts, // 既に上限
      false,
      sharedLogsDir,
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

  it("retries Todo-Writer in the same session when OpenCode Unexpected error occurs", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-todowriter-unexpected-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-todowriter-unexpected-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");

    mockRunOpencode.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr:
        "Error: Unexpected error, check log file at ~/.local/share/opencode/log/2026-04-07T014835.log for more details\n",
    } as any);

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
      0,
      false,
    );

    expect(res.abortLoop).toBe(false);
    expect(res.skipExecutorThisStep).toBe(true);
    expect(res.forceTodoWriterNextStep).toBe(true);
    expect(res.sessionId).toBe("sess-1");
    expect(res.restartCount).toBe(0);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(
      saved.failure_budget?.executor_opencode_error_consecutive_in_session,
    ).toBe(1);
    expect(saved.failure_budget?.last_failure_kind).toBe(
      "todo_writer_opencode_error",
    );
  });

  it("retries Todo-Writer in the same session when a generic OpenCode Error occurs", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-todowriter-generic-error-"),
    );
    const tmpLogs = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-logs-todowriter-generic-error-"),
    );
    const acceptancePath = path.join(tmpState, "acceptance-index.json");
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(acceptancePath, "{}", "utf8");

    mockRunOpencode.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "Error: Input exceeds context window of this model\n",
    } as any);

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
      0,
      false,
    );

    expect(res.abortLoop).toBe(false);
    expect(res.skipExecutorThisStep).toBe(true);
    expect(res.forceTodoWriterNextStep).toBe(true);
    expect(res.sessionId).toBe("sess-1");
    expect(res.restartCount).toBe(0);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(
      saved.failure_budget?.executor_opencode_error_consecutive_in_session,
    ).toBe(1);
    expect(saved.failure_budget?.last_failure_kind).toBe(
      "todo_writer_opencode_error",
    );
    expect(saved.failure_budget?.last_failure_summary).toContain(
      "Input exceeds context window of this model",
    );
  });

  it("detects OpenCode Unexpected error and retries within the same session", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-opencode-unexpected-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    mockRunOpencode.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr:
        "Error: Unexpected error, check log file at ~/.local/share/opencode/log/2026-04-07T014835.log for more details\n",
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      1,
      "sess-1",
      [],
      stepLogPath(1),
      auditLogPath(1),
      status,
      statusPath,
      0,
      false,
      sharedLogsDir,
    );

    expect(res.abortLoop).toBe(false);
    expect(res.skipAuditorThisStep).toBe(true);
    expect(res.sessionId).toBe("sess-1");
    expect(res.restartCount).toBe(0);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(
      saved.failure_budget?.executor_opencode_error_consecutive_in_session,
    ).toBe(1);
    expect(saved.failure_budget?.last_failure_kind).toBe(
      "executor_opencode_error",
    );
    expect(saved.failure_budget?.last_failure_summary).toContain(
      "Unexpected error",
    );
  });

  it("detects generic OpenCode Error output and retries within the same session", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-opencode-generic-error-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    mockRunOpencode.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "Error: Input exceeds context window of this model\n",
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      1,
      "sess-1",
      [],
      stepLogPath(1),
      auditLogPath(1),
      status,
      statusPath,
      0,
      false,
      sharedLogsDir,
    );

    expect(res.abortLoop).toBe(false);
    expect(res.skipAuditorThisStep).toBe(true);
    expect(res.sessionId).toBe("sess-1");
    expect(res.restartCount).toBe(0);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(
      saved.failure_budget?.executor_opencode_error_consecutive_in_session,
    ).toBe(1);
    expect(saved.failure_budget?.last_failure_kind).toBe(
      "executor_opencode_error",
    );
    expect(saved.failure_budget?.last_failure_summary).toContain(
      "Input exceeds context window of this model",
    );
  });

  it("restarts the executor session after 3 consecutive OpenCode reasoning-item errors", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-opencode-reasoning-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    const reasoningError =
      "Error: Item 'rs_dummy_reasoning_item_id' of type 'reasoning' was provided without its required following item.";

    let execCallCount = 0;
    mockRunOpencode.mockImplementation(async (args: string[]) => {
      if (args[0] === "run" && args.includes("orch-exec")) {
        execCallCount += 1;
        return {
          code: 1,
          stdout: "",
          stderr: reasoningError,
        } as any;
      }

      if (args[0] === "export") {
        // restartFromSafety safeExport
        return { code: 0, stdout: "" } as any;
      }

      if (args[0] === "run" && args.includes("orch-todo-write")) {
        // restartSession's todo-writer call
        return { code: 0, stdout: "" } as any;
      }

      if (args[0] === "session" && args[1] === "list") {
        // findSessionIdByTitle during restartSession
        const sessions = [
          { id: "sess-restarted", title: "orchestrator-loop test-task" },
        ];
        return { code: 0, stdout: JSON.stringify(sessions) } as any;
      }

      return { code: 0, stdout: "" } as any;
    });

    let restartCount = 0;
    let sessionId = "sess-1";

    for (let step = 1; step <= 3; step += 1) {
      const res = await runExecutorAndAuditorStep(
        baseOpts,
        step,
        sessionId,
        [],
        stepLogPath(step),
        auditLogPath(step),
        status,
        statusPath,
        restartCount,
        false,
        sharedLogsDir,
      );

      if (step < 3) {
        expect(res.sessionId).toBe("sess-1");
        expect(res.restartCount).toBe(0);
        expect(res.abortLoop).toBe(false);
        expect(res.skipAuditorThisStep).toBe(true);
      } else {
        expect(res.sessionId).toBe("sess-restarted");
        expect(res.restartCount).toBe(1);
        expect(res.abortLoop).toBe(false);
        expect(res.skipAuditorThisStep).toBe(true);
      }

      sessionId = res.sessionId;
      restartCount = res.restartCount;
    }

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.last_session_id).toBe("sess-restarted");
    expect(
      saved.failure_budget?.executor_opencode_error_consecutive_in_session,
    ).toBe(0);
    expect(saved.failure_budget?.executor_opencode_error_last_session_id).toBe(
      "sess-restarted",
    );
    expect(saved.failure_budget?.last_failure_kind).toBe(
      "executor_opencode_error",
    );
    expect(saved.failure_budget?.last_failure_summary).toContain("reasoning");
    expect(execCallCount).toBe(3);
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
      stepLogPath(1),
      auditLogPath(1),
      status,
      sharedStatusPath(),
      0,
      false,
      sharedLogsDir,
    );

    expect(res.forceTodoWriterNextStep).toBe(true);
    const proposals = loadProposals(sharedProposalsPath());
    expect(proposals.proposals.some((p) => p.kind === "need_replan")).toBe(
      true,
    );
  });

  it("resolves older open auto-resolvable need_replan entries before appending the latest one", async () => {
    const status = createStatus();
    writeProposalsJson(sharedStateDir, [
      {
        id: "p-old-replan",
        source: "executor",
        cycle: 0,
        kind: "need_replan",
        priority: "high",
        summary: "older replan signal",
        related_todo_ids: ["T1"],
        related_requirement_ids: ["R1"],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
      {
        id: "p-other-kind",
        source: "executor",
        cycle: 0,
        kind: "audit_failure",
        priority: "high",
        summary: "keep me open",
        related_todo_ids: ["T2"],
        related_requirement_ids: ["R2"],
        status: "open",
        auto_resolvable: true,
        created_at: "2026-03-29T00:00:00.000Z",
      },
    ]);

    const stdout = [
      "STEP_INTENT: replan R1 sharpen the todo",
      "STEP_VERIFY: not_ready - still narrowing scope",
      "STEP_BLOCKER: general need_replan latest actionable split is required",
      "STEP_AUDIT: in_progress R1",
    ].join("\n");

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      1,
      "sess-1",
      [],
      stepLogPath(1),
      auditLogPath(1),
      status,
      sharedStatusPath(),
      0,
      false,
      sharedLogsDir,
    );

    expect(res.forceTodoWriterNextStep).toBe(true);
    const proposals = loadProposals(sharedProposalsPath());
    const oldNeedReplan = proposals.proposals.find(
      (p) => p.id === "p-old-replan",
    );
    expect(oldNeedReplan?.status).toBe("resolved");
    expect(
      proposals.proposals.filter(
        (p) => p.status === "open" && p.kind === "need_replan",
      ),
    ).toHaveLength(1);
    expect(
      proposals.proposals.find((p) => p.id === "p-other-kind")?.status,
    ).toBe("open");
  });

  it("invokes auditor when STEP_AUDIT ready and propagates done + report", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-final-audit-"),
    );
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(
      path.join(tmpState, "acceptance-index.json"),
      JSON.stringify(
        {
          version: 1,
          requirements: [
            { id: "R1", title: "Requirement 1" },
            { id: "R2", title: "Requirement 2" },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpState, "todo.json"),
      JSON.stringify(
        {
          todos: [
            {
              id: "T1",
              summary: "final validation",
              status: "completed",
              related_requirement_ids: ["R1", "R2"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const execStdout = [
      "STEP_TODO: T1 R1,R2 do something",
      "STEP_INTENT: verify R1,R2 監査前の仕上げを行った",
      "STEP_VERIFY: ready cmd-npm-test 監査に必要な根拠が揃った",
      "STEP_AUDIT: ready R1,R2",
    ].join("\n");

    const incrementalAuditPayload = {
      audit_mode: "incremental",
      scope_requirement_ids: ["R1", "R2"],
      done: false,
      requirements: [
        { id: "R1", passed: true },
        { id: "R2", passed: true },
      ],
    };
    const finalAuditPayload = {
      audit_mode: "final_full",
      scope_requirement_ids: ["R1", "R2"],
      done: true,
      requirements: [
        { id: "R1", passed: true },
        { id: "R2", passed: true },
      ],
    };
    const incrementalAuditStdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify(incrementalAuditPayload),
      },
    });
    const finalAuditStdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify(finalAuditPayload),
      },
    });

    mockRunOpencode
      .mockResolvedValueOnce({ code: 0, stdout: execStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: incrementalAuditStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any)
      .mockResolvedValueOnce({ code: 0, stdout: finalAuditStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      3,
      "sess-1",
      [],
      stepLogPath(3),
      auditLogPath(3),
      status,
      statusPath,
      0,
      false,
      sharedLogsDir,
    );

    expect(res.done).toBe(true);
    expect(res.abortLoop).toBe(false);
    expect(res.skipAuditorThisStep).toBe(false);

    expect(status.last_auditor_report).toBeDefined();
    expect(status.last_auditor_report?.cycle).toBe(3);
    expect(status.last_auditor_report?.audit_mode).toBe("final_full");
    expect(status.last_auditor_report?.scope_requirement_ids).toEqual([
      "R1",
      "R2",
    ]);
    expect(status.last_auditor_report?.done).toBe(true);
    expect(status.last_auditor_report?.requirements).toHaveLength(2);
    const [r1, r2] = status.last_auditor_report!.requirements;
    // Executor 実行 + incremental auditor + incremental cleanup lookup +
    // final full auditor + final cleanup lookup の 5 回呼ばれていることを確認
    expect(mockRunOpencode).toHaveBeenCalledTimes(5);

    const execCallArgs = mockRunOpencode.mock.calls[0][0] as string[];
    const incrementalAuditCallArgs = mockRunOpencode.mock
      .calls[1][0] as string[];
    const finalAuditCallArgs = mockRunOpencode.mock.calls[3][0] as string[];

    // Executor はメインセッションを共有している
    expect(execCallArgs).toContain("--session");
    expect(execCallArgs).toContain("sess-1");

    // Auditor は incremental と final_full の両方で --session を使わず、--title で専用セッションを作る
    expect(incrementalAuditCallArgs).not.toContain("--session");
    expect(incrementalAuditCallArgs).toContain("--title");
    expect(finalAuditCallArgs).not.toContain("--session");
    expect(finalAuditCallArgs).toContain("--title");

    // final_full の report では scoped requirements がすべて passed になることを確認
    expect(r1).toMatchObject({ id: "R1", passed: true });
    expect(r2).toMatchObject({ id: "R2", passed: true });
  });

  it("invokes auditor when STEP_AUDIT ready using persisted artifacts even without new commands or diffs", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-persisted-evidence-"),
    );
    const statusPath = path.join(tmpState, "status.json");

    // Prepare a todo.json with one completed todo that has result_artifacts.
    const todoPath = path.join(tmpState, "todo.json");
    const todoFile = {
      todos: [
        {
          id: "T-verify-R1",
          summary: "verification for R1",
          status: "completed",
          related_requirement_ids: ["R1"],
          result_artifacts: [
            {
              kind: "verification_v1",
              path: ".opencode/orchestrator/task/artifacts/T-verify-R1.json",
              summary: "Verification for R1",
            },
          ],
        },
      ],
    };
    fs.writeFileSync(todoPath, JSON.stringify(todoFile), "utf8");

    const execStdout = [
      "STEP_INTENT: verify R1 persisted evidence self-check",
      "STEP_VERIFY: ready - persisted evidence only",
      "STEP_AUDIT: ready R1",
    ].join("\n");

    const incrementalAuditPayload = {
      audit_mode: "incremental",
      scope_requirement_ids: ["R1"],
      done: false,
      requirements: [{ id: "R1", passed: true }],
    };
    const finalAuditPayload = {
      audit_mode: "final_full",
      scope_requirement_ids: ["R1"],
      done: true,
      requirements: [{ id: "R1", passed: true }],
    };
    const incrementalAuditStdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify(incrementalAuditPayload),
      },
    });
    const finalAuditStdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify(finalAuditPayload),
      },
    });

    mockRunOpencode
      .mockResolvedValueOnce({ code: 0, stdout: execStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: incrementalAuditStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any)
      .mockResolvedValueOnce({ code: 0, stdout: finalAuditStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      4,
      "sess-1",
      [],
      stepLogPath(4),
      auditLogPath(4),
      status,
      statusPath,
      0,
      false,
      sharedLogsDir,
    );

    expect(res.done).toBe(true);
    expect(res.abortLoop).toBe(false);
    expect(res.skipAuditorThisStep).toBe(false);
    expect(status.last_auditor_report?.audit_mode).toBe("final_full");
    expect(mockRunOpencode).toHaveBeenCalledTimes(5);
  });

  it("merges auditor failures into proposals.json when replanning is already required", async () => {
    const status = createStatus();
    const execStdout = [
      "STEP_BLOCKER: T4-login need_replan ログイン関連の作業単位を見直したい",
      "STEP_INTENT: replan R3-login 監査で指摘された要件を再整理したい",
      "STEP_VERIFY: ready cmd-login-test ログイン処理の検証は実行済み",
      "STEP_AUDIT: ready R3-login",
    ].join("\n");

    const auditPayload = {
      done: false,
      requirements: [
        {
          id: "R3-login",
          passed: false,
          reason: "ログインに関する受け入れ条件が未達",
        },
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
      stepLogPath(6),
      auditLogPath(6),
      status,
      sharedStatusPath(),
      0,
      false,
      sharedLogsDir,
    );

    const proposals = loadProposals(sharedProposalsPath());
    expect(proposals.proposals.some((p) => p.kind === "need_replan")).toBe(
      true,
    );
    expect(proposals.proposals.some((p) => p.kind === "audit_failure")).toBe(
      true,
    );
  });

  it("retries auditor once when output does not contain valid JSON", async () => {
    const status = createStatus();

    const execStdout = [
      "STEP_INTENT: verify R1 棚卸し",
      "STEP_VERIFY: ready cmd-test R1 の検証は完了",
      "STEP_AUDIT: ready R1",
    ].join("\n");

    // 1 回目の auditor 実行では契約どおりの JSON が含まれない想定
    const brokenAuditStdout = "not json at all";

    const auditPayload = {
      audit_mode: "incremental",
      scope_requirement_ids: ["R1"],
      done: false,
      requirements: [{ id: "R1", passed: true }],
    };
    const validAuditStdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify(auditPayload),
      },
    });
    const finalAuditPayload = {
      audit_mode: "final_full",
      scope_requirement_ids: ["R1"],
      done: false,
      requirements: [
        {
          id: "R1",
          passed: false,
          reason: "Final full audit still lacks repository-wide proof",
          failure_kind: "weak_evidence",
          evidence_gaps: [
            "No final full anchor beyond the retried incremental check",
          ],
        },
      ],
    };
    const finalAuditStdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify(finalAuditPayload),
      },
    });

    const sessionListStdout = JSON.stringify([
      { id: "aud-sess-1", title: "orchestrator-audit test-task step=8" },
    ]);

    // 実行順:
    //   1. executor
    //   2. auditor (1 回目: 契約外出力)
    //   3. session list → auditor セッション ID を取得
    //   4. auditor (2 回目: 同じセッションに対して run --session)
    //   5. session delete
    //   6. final_full auditor
    //   7. final_full cleanup lookup
    mockRunOpencode
      .mockResolvedValueOnce({ code: 0, stdout: execStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: brokenAuditStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: sessionListStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: validAuditStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "" } as any)
      .mockResolvedValueOnce({ code: 0, stdout: finalAuditStdout } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "[]" } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      8,
      "sess-1",
      [],
      stepLogPath(8),
      auditLogPath(8),
      status,
      sharedStatusPath(),
      0,
      false,
      sharedLogsDir,
    );

    expect(res.done).toBe(false);
    expect(res.abortLoop).toBe(false);
    expect(res.skipAuditorThisStep).toBe(false);
    expect(status.last_auditor_report?.audit_mode).toBe("final_full");

    expect(mockRunOpencode).toHaveBeenCalledTimes(7);
    const auditFirstCallArgs = mockRunOpencode.mock.calls[1][0] as string[];
    const auditSecondCallArgs = mockRunOpencode.mock.calls[3][0] as string[];
    const finalAuditCallArgs = mockRunOpencode.mock.calls[5][0] as string[];

    // 1 回目は新規 orch-audit セッション、2 回目は run --session で同一
    // セッションに対する continue になっていることを確認する。
    expect(auditFirstCallArgs).toContain("--command");
    expect(auditFirstCallArgs).toContain("orch-audit");
    expect(auditFirstCallArgs).toContain("--title");
    expect(auditFirstCallArgs).not.toContain("--session");

    expect(auditSecondCallArgs).toContain("--session");
    expect(auditSecondCallArgs).not.toContain("--command");

    expect(finalAuditCallArgs).toContain("--command");
    expect(finalAuditCallArgs).toContain("orch-audit");
    expect(finalAuditCallArgs).toContain("--title");
    expect(finalAuditCallArgs).not.toContain("--session");

    expect(status.last_auditor_report).toBeDefined();
    expect(status.last_auditor_report?.cycle).toBe(8);
    expect(status.last_auditor_report?.audit_mode).toBe("final_full");
    expect(status.last_auditor_report?.done).toBe(false);
    expect(status.last_auditor_report?.requirements).toHaveLength(1);
    expect(status.last_auditor_report?.requirements[0]).toMatchObject({
      id: "R1",
      passed: false,
    });
  });

  it("creates scope_change and priority_shift proposals from executor blockers", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-scope-shift-"),
    );
    const statusPath = path.join(tmpState, "status.json");
    fs.writeFileSync(
      path.join(tmpState, "acceptance-index.json"),
      "{}",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tmpState, "todo.json"),
      JSON.stringify({ todos: [] }),
      "utf8",
    );

    const execStdout = [
      "STEP_TODO: T1 R1 scope change step",
      "STEP_BLOCKER: T1 scope_change 範囲を再調整したい",
      "STEP_BLOCKER: general priority_shift 優先度を組み替えたい",
      "STEP_INTENT: implement R1 スコープ見直しを進めた",
      "STEP_VERIFY: not_ready - まだ監査根拠が不足している",
      "STEP_AUDIT: in_progress R1",
    ].join("\n");

    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: execStdout,
    } as any);

    const res = await runExecutorAndAuditorStep(
      baseOpts,
      7,
      "sess-1",
      [],
      stepLogPath(7),
      auditLogPath(7),
      status,
      statusPath,
      0,
      false,
      sharedLogsDir,
    );

    expect(res.abortLoop).toBe(false);
    const proposals = loadProposals(path.join(tmpState, "proposals.json"));
    expect(proposals.proposals.some((p) => p.kind === "scope_change")).toBe(
      true,
    );
    expect(proposals.proposals.some((p) => p.kind === "priority_shift")).toBe(
      true,
    );
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
      stepLogPath(4),
      auditLogPath(4),
      status,
      sharedStatusPath(),
      0,
      false,
      sharedLogsDir,
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
      audit_mode: "incremental",
      scope_requirement_ids: ["R1"],
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
      stepLogPath(5),
      auditLogPath(5),
      status,
      statusPath,
      0,
      false,
      sharedLogsDir,
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
      audit_mode: "final_full",
      scope_requirement_ids: ["R1"],
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
      sharedLogsDir,
    );

    expect(mockRunOpencode).toHaveBeenCalledTimes(1);
    expect(res.done).toBe(false);

    const execCallArgs = mockRunOpencode.mock.calls[0][0] as string[];
    expect(execCallArgs).not.toContain(statusPath);
  });

  it("aborts loop when proposals are already present in status", async () => {
    const status = createStatus();
    const tmpState = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-steps-state-proposals-"),
    );
    writeProposalsJson(tmpState, [
      {
        id: "p-1",
        source: "executor",
        cycle: 1,
        kind: "env_blocked",
        priority: "critical",
        summary: "env blocked",
        details: "missing tool",
        related_requirement_ids: ["R8"],
        related_todo_ids: [],
        status: "open",
        auto_resolvable: false,
        created_at: "2026-03-29T00:00:00.000Z",
      },
    ]);

    mockRunOpencode.mockResolvedValueOnce({ code: 0, stdout: "" } as any);

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
      sharedLogsDir,
    );

    expect(res.abortLoop).toBe(true);
    expect(res.skipAuditorThisStep).toBe(false);
    expect(res.done).toBe(false);
  });

  it("skips auditor and records verification gap when audit is requested without STEP_VERIFY ready", async () => {
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
      sharedLogsDir,
    );

    expect(res.done).toBe(false);
    expect(mockRunOpencode).toHaveBeenCalledTimes(1);
    expect(status.failure_budget?.consecutive_verification_gaps).toBe(2);
    const proposals = loadProposals(path.join(tmpState, "proposals.json"));
    expect(proposals.proposals.some((p) => p.kind === "verification_gap")).toBe(
      true,
    );
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
      sharedLogsDir,
    );

    expect(status.failure_budget?.consecutive_verification_gaps).toBe(0);
  });

  it("records a contract gap when executor omits STEP_INTENT and STEP_VERIFY", async () => {
    const status = createStatus();
    status.failure_budget = {
      todo_writer_safety_restarts: 0,
      executor_safety_restarts: 0,
      consecutive_env_blocked: 0,
      consecutive_audit_failures: 0,
      consecutive_verification_gaps: 0,
      consecutive_contract_gaps: 1,
    };
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
      sharedLogsDir,
    );

    expect(res.done).toBe(false);
    expect(status.failure_budget?.consecutive_contract_gaps).toBe(2);
    const proposals = loadProposals(path.join(tmpState, "proposals.json"));
    expect(proposals.proposals.some((p) => p.kind === "contract_gap")).toBe(
      true,
    );
  });

  it("treats malformed STEP_INTENT and STEP_VERIFY values as a contract gap", async () => {
    const status = createStatus();
    status.failure_budget = {
      todo_writer_safety_restarts: 0,
      executor_safety_restarts: 0,
      consecutive_env_blocked: 0,
      consecutive_audit_failures: 0,
      consecutive_verification_gaps: 0,
      consecutive_contract_gaps: 1,
    };
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
      sharedLogsDir,
    );

    expect(status.failure_budget?.consecutive_contract_gaps).toBe(2);
    const proposals = loadProposals(path.join(tmpState, "proposals.json"));
    expect(proposals.proposals.some((p) => p.kind === "contract_gap")).toBe(
      true,
    );
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
        stdout: "I'm sorry, but I cannot assist with that request.",
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
      sharedLogsDir,
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
