import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { LoopOptions } from "../src/cli-args.js";
import { runLoop } from "../src/orchestrator-loop.js";
import type { OrchestratorStatus } from "../src/orchestrator-status.js";
import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";

const baseOpts: LoopOptions = {
  task: "test-task-proposals",
  maxLoop: 1,
  maxRestarts: 0,
  files: [],
  prompt: "test",
  sessionId: undefined,
  continueLast: false,
  commitOnDone: false,
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

  it("prints proposal details when status.json.proposals is non-empty before starting a new session", async () => {
    const fakeXdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-loop-proposals-"),
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const stateDir = getOrchestratorStateDir(baseOpts.task);
    fs.mkdirSync(stateDir, { recursive: true });

    const statusPath = path.join(stateDir, "status.json");
    const status: OrchestratorStatus = {
      version: 1,
      proposals: [
        {
          id: "p-1",
          source: "executor",
          cycle: 3,
          kind: "env_blocked",
          summary:
            "環境依存のエラー (env_blocked) が 3 回連続で発生し、Executor ループを継続できません。必須コマンドや command-policy の前提を見直してほしい。",
          details: "general: env_blocked: dotnet が見つからない",
        },
      ],
    };
    fs.writeFileSync(statusPath, JSON.stringify(status), "utf8");

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
            helper_availability: {
              "helper:grep": "available",
              "helper:rg": "available",
              "helper:sort": "available",
              "helper:sort-with-flags": "available",
              "helper:uniq": "available",
              "helper:uniq-with-flags": "available",
              "helper:wc": "available",
              "helper:head": "available",
              "helper:tail": "available",
              "helper:cut": "available",
              "helper:tr": "available",
              "helper:comm": "available",
              "helper:cat": "available",
              "helper:ls": "available",
              "helper:jq": "available",
              "helper:true": "available",
              "helper:false": "available",
              "helper:test": "available",
              "helper:bracket": "available",
            },
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
      "status.json.proposals is non-empty before starting a new session",
    );
    expect(lines).toContain("Proposals from previous runs:");
    expect(lines).toContain("[executor] kind=env_blocked cycle=3 id=p-1");
    expect(lines).toContain(
      "summary: 環境依存のエラー (env_blocked) が 3 回連続で発生し",
    );
    expect(lines).toContain(
      "details: general: env_blocked: dotnet が見つからない",
    );
  });
});
