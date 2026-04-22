import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { LoopOptions } from "../src/cli-args.js";
import { runOpencode } from "../src/orchestrator-process.js";
import { runLoop } from "../src/orchestrator-loop.js";
import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";

vi.mock("../src/orchestrator-process.js", () => ({
  runOpencode: vi.fn(),
}));

const mockRunOpencode = runOpencode as unknown as ReturnType<typeof vi.fn>;

const baseOpts: LoopOptions = {
  task: "test-task-proposals",
  maxLoop: 1,
  maxRestarts: 0,
  files: [],
  prompt: "test",
  sessionId: undefined,
  continueLast: false,
  commitOnDone: false,
  dangerouslySkipCommandPolicy: false,
  bwrapSkipCommandPolicy: false,
  bwrapArgs: [],
};

describe("runLoop proposals gate", () => {
  const originalXdg = process.env.XDG_STATE_HOME;
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    process.env.XDG_STATE_HOME = originalXdg;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("prints proposal details when proposals.json has an open env_blocked entry before starting a new session", async () => {
    const fakeXdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-loop-proposals-"),
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const stateDir = getOrchestratorStateDir(baseOpts.task);
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "status.json"),
      JSON.stringify({ version: 1 }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 3,
              kind: "env_blocked",
              priority: "critical",
              summary:
                "環境依存のエラー (env_blocked) が 3 回連続で発生し、Executor ループを継続できません。必須コマンドや command-policy の前提を見直してほしい。",
              details: "general: env_blocked: dotnet が見つからない",
              related_requirement_ids: ["R8"],
              related_todo_ids: [],
              status: "open",
              auto_resolvable: false,
              created_at: "2026-03-29T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    // command-policy.json is required by enforceCommandPolicyGate; create
    // a minimal valid file so that the loop can reach the proposals gate.
    const policyPath = path.join(stateDir, "command-policy.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify(
        {
          version: 1,
          summary: {
            loop_status: "ready_for_loop",
            available_helper_commands: [
              "grep",
              "rg",
              "sort",
              "uniq",
              "wc",
              "head",
              "tail",
              "cut",
              "tr",
              "comm",
              "cat",
              "ls",
              "jq",
              "true",
              "false",
              "test",
              "[",
            ],
            last_spec_check_status: "ok",
            last_spec_check_feasible_for_loop: true,
            blocking_failure_types: [],
            blocking_issue_ids: [],
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const done = await runLoop(baseOpts);
    expect(done).toBe(false);

    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => c.join(" ")).join("\n");

    expect(lines).toContain(
      "proposals.json に未解決の非自動解決 proposal が残っているため、新しいセッションを開始できません。",
    );
    expect(lines).toContain("以前の実行で記録された proposal:");
    expect(lines).toContain("[executor] kind=env_blocked cycle=3 id=p-1");
    expect(lines).toContain(
      "summary: 環境依存のエラー (env_blocked) が 3 回連続で発生し",
    );
    expect(lines).toContain(
      "details: general: env_blocked: dotnet が見つからない",
    );
  });

  it("starts with only auto-resolvable proposals and re-feeds them into Todo-Writer planning", async () => {
    const fakeXdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-loop-autoresolve-"),
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const stateDir = getOrchestratorStateDir(baseOpts.task);
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "status.json"),
      JSON.stringify({ version: 1, last_session_id: "sess-1" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "acceptance-index.json"),
      JSON.stringify({ version: 1, north_star: "test", requirements: [] }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({ todos: [] }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-open-auto",
              source: "executor",
              cycle: 3,
              kind: "need_replan",
              priority: "high",
              summary: "todo-writer に再計画の根拠を渡す",
              details: "general: need_replan: todo-writer に再計画の根拠を渡す",
              related_requirement_ids: ["R7"],
              related_todo_ids: ["T7"],
              status: "open",
              auto_resolvable: true,
              created_at: "2026-03-29T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(stateDir, "command-policy.json"),
      JSON.stringify(
        {
          version: 1,
          summary: {
            loop_status: "ready_for_loop",
            available_helper_commands: ["grep", "rg", "wc", "test", "["],
            last_spec_check_status: "ok",
            last_spec_check_feasible_for_loop: true,
            blocking_failure_types: [],
            blocking_issue_ids: [],
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    mockRunOpencode
      .mockResolvedValueOnce({ code: 0, stdout: "" } as any)
      .mockResolvedValueOnce({
        code: 0,
        stdout: [
          "STEP_TODO: T1 R1 do something",
          "STEP_INTENT: implement R1 進めた",
          "STEP_VERIFY: not_ready - まだ監査根拠が不足している",
          "STEP_AUDIT: in_progress R1",
        ].join("\n"),
      } as any)
      .mockResolvedValueOnce({ code: 0, stdout: "" } as any);

    const done = await runLoop({ ...baseOpts, sessionId: "sess-1" });
    expect(done).toBe(false);

    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(lines).not.toContain(
      "proposals.json に未解決の非自動解決 proposal が残っているため、新しいセッションを開始できません。",
    );

    const todoWriterCall = mockRunOpencode.mock.calls[0][0] as string[];
    const joined = todoWriterCall.join(" ");
    expect(joined).toContain("orch-todo-write");
    expect(joined).toContain("todo-writer に再計画の根拠を渡す");
  });
});
