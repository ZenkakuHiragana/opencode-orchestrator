import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { runClear, type ClearOptions } from "../src/orchestrator-clear.js";
import {
  saveStatusJson,
  type OrchestratorStatus,
} from "../src/orchestrator-status.js";
import {
  getOrchestratorBaseDir,
  getOrchestratorStateDir,
} from "../src/orchestrator-paths.js";

describe("runClear", () => {
  it("clears proposals and resets consecutive_env_blocked counters", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-clear-base-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "orch-clear-task";
    const stateDir = getOrchestratorStateDir(task);
    fs.mkdirSync(stateDir, { recursive: true });
    const statusPath = path.join(stateDir, "status.json");

    const status: OrchestratorStatus = {
      version: 1,
      proposals: [
        {
          id: "p-1",
          source: "executor",
          cycle: 1,
          kind: "env_blocked",
          summary: "env blocked",
          details: "missing tool",
        },
      ],
      consecutive_env_blocked: 3,
      failure_budget: {
        todo_writer_safety_restarts: 0,
        executor_safety_restarts: 0,
        consecutive_env_blocked: 3,
        consecutive_audit_failures: 0,
        consecutive_verification_gaps: 0,
        consecutive_contract_gaps: 0,
      },
    };

    saveStatusJson(statusPath, status);

    const opts: ClearOptions = {
      task,
      clearProposals: true,
      yes: true,
    };

    await runClear(opts);

    const saved = JSON.parse(
      fs.readFileSync(statusPath, "utf8"),
    ) as OrchestratorStatus;
    expect(saved.proposals).toEqual([]);
    expect(saved.consecutive_env_blocked).toBe(0);
    expect(saved.failure_budget?.consecutive_env_blocked).toBe(0);
  });
});
