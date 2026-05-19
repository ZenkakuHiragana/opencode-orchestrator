import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

declare const process: { env: Record<string, string | undefined> };

import {
  parseClearArgs,
  runClear,
  type ClearOptions,
} from "../src/orchestrator-clear.js";
import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";

describe("runClear", () => {
  it("rejects multiple target selectors at parse time", () => {
    expect(() =>
      parseClearArgs([
        "--task",
        "orch-clear-task",
        "--proposals",
        "--resolve",
        "p-1",
      ]),
    ).toThrow(/1 つだけ|exactly one/i);
  });

  it("resolves all open proposals in proposals.json", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-clear-base-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "orch-clear-task";
    const stateDir = getOrchestratorStateDir(task);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 1,
              kind: "env_blocked",
              priority: "critical",
              summary: "env blocked",
              details: "missing tool",
              related_requirement_ids: ["R8"],
              related_todo_ids: ["T1"],
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

    const opts: ClearOptions = {
      task,
      clearProposals: true,
      yes: true,
    };

    await runClear(opts);

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "proposals.json"), "utf8"),
    ) as {
      proposals: Array<{ status: string; resolved_by?: string }>;
    };
    expect(saved.proposals).toHaveLength(1);
    expect(saved.proposals[0].status).toBe("resolved");
    expect(saved.proposals[0].resolved_by).toBe("cli");
  });

  it("resolves a single proposal by id", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-clear-base-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "orch-clear-resolve-task";
    const stateDir = getOrchestratorStateDir(task);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 1,
              kind: "need_replan",
              priority: "high",
              summary: "needs resolve",
              related_requirement_ids: ["R7"],
              related_todo_ids: ["T7"],
              status: "open",
              auto_resolvable: true,
              created_at: "2026-03-29T00:00:00.000Z",
            },
            {
              id: "p-2",
              source: "auditor",
              cycle: 1,
              kind: "audit_failure",
              priority: "high",
              summary: "other",
              related_requirement_ids: ["R19"],
              related_todo_ids: [],
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

    const opts: ClearOptions = {
      task,
      clearProposals: false,
      yes: true,
      resolveId: "p-1",
    };

    await runClear(opts);

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "proposals.json"), "utf8"),
    ) as { proposals: Array<{ id: string; status: string }> };
    expect(saved.proposals.find((p) => p.id === "p-1")?.status).toBe(
      "resolved",
    );
    expect(saved.proposals.find((p) => p.id === "p-2")?.status).toBe("open");
  });

  it("dismisses a single proposal by id", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-clear-base-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "orch-clear-dismiss-task";
    const stateDir = getOrchestratorStateDir(task);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 1,
              kind: "need_replan",
              priority: "high",
              summary: "needs dismiss",
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

    const opts: ClearOptions = {
      task,
      clearProposals: false,
      yes: true,
      dismissId: "p-1",
    };

    await runClear(opts);

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "proposals.json"), "utf8"),
    ) as { proposals: Array<{ status: string; resolved_by?: string }> };
    expect(saved.proposals[0].status).toBe("dismissed");
    expect(saved.proposals[0].resolved_by).toBe("cli");
  });

  it("reports a missing proposal id without mutating state", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-clear-base-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "orch-clear-missing-task";
    const stateDir = getOrchestratorStateDir(task);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 1,
              kind: "need_replan",
              priority: "high",
              summary: "existing proposal",
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

    const code = await runClear({
      task,
      clearProposals: false,
      yes: true,
      resolveId: "missing",
    });

    expect(code).toBe(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "proposal の ID が見つかりません: missing",
    );
    errSpy.mockRestore();
  });

  it("reports no proposals to update when only closed proposals remain", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-clear-base-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "orch-clear-no-open-task";
    const stateDir = getOrchestratorStateDir(task);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 1,
              kind: "need_replan",
              priority: "high",
              summary: "already resolved",
              related_requirement_ids: ["R1"],
              related_todo_ids: [],
              status: "resolved",
              auto_resolvable: true,
              created_at: "2026-03-29T00:00:00.000Z",
              resolved_at: "2026-03-29T01:00:00.000Z",
              resolved_by: "auto",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await runClear({ task, clearProposals: true, yes: true });

    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "更新対象の proposal はありません",
    );
    errSpy.mockRestore();
  });

  it("reports an unknown task instead of treating it as an empty proposal set", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-clear-base-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const knownStateDir = getOrchestratorStateDir("known-task");
    fs.mkdirSync(knownStateDir, { recursive: true });

    await runClear({ task: "missing-task", clearProposals: true, yes: true });

    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "タスク 'missing-task' は見つかりませんでした",
    );
    errSpy.mockRestore();
  });
});
