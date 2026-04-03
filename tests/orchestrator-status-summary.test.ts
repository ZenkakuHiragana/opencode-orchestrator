import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

import { runStatusCommand } from "../src/orchestrator-status.js";

describe("runStatusCommand rich summary (R11)", () => {
  const originalError = console.error;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;
  let prevXdg: string | undefined;

  beforeEach(() => {
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    prevXdg = process.env.XDG_STATE_HOME;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalError;
    if (prevLC_ALL === undefined) {
      delete process.env.LC_ALL;
    } else {
      process.env.LC_ALL = prevLC_ALL;
    }
    if (prevLANG === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = prevLANG;
    }
    if (prevXdg === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = prevXdg;
    }
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("prints a localized rich summary in Japanese", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-status-summary-ja-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const task = "summary-task-ja";
    const stateDir = path.join(baseDir, task, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    // loop_status=needs_refinement -> planning フェーズ
    fs.writeFileSync(
      path.join(stateDir, "command-policy.json"),
      JSON.stringify(
        {
          version: 1,
          summary: {
            loop_status: "needs_refinement",
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    // status.json with last_failure_summary
    fs.writeFileSync(
      path.join(stateDir, "status.json"),
      JSON.stringify(
        {
          version: 1,
          failure_budget: {
            last_failure_summary:
              "計画フェーズや事前チェックが完了していないため再開できません",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    // proposals.json with two open proposals
    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            { id: "p-1", status: "open" },
            { id: "p-2", status: "open" },
            { id: "p-3", status: "resolved" },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await runStatusCommand({ argv: ["--task", task] });

    expect(code).toBe(0);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");

    expect(text).toContain(task);
    expect(text).toContain("計画");
    expect(text).toContain("直近の失敗");
    expect(text).toContain("proposal が 2 件あります");
    expect(text).toContain("ococ fix --task");
  });

  it("prints a localized rich summary in English", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-status-summary-en-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const task = "summary-task-en";
    const stateDir = path.join(baseDir, task, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "command-policy.json"),
      JSON.stringify(
        {
          version: 1,
          summary: {
            loop_status: "ready_for_loop",
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.writeFileSync(
      path.join(stateDir, "status.json"),
      JSON.stringify(
        {
          version: 1,
          failure_budget: {
            last_failure_summary: "last failure summary for test",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [{ id: "p-1", status: "open" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await runStatusCommand({ argv: ["--task", task] });

    expect(code).toBe(0);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");

    expect(text).toContain(task);
    expect(text.toLowerCase()).toContain("phase");
    expect(text).toContain("Last failure: last failure summary for test");
    expect(text).toContain("1 open proposal");
    expect(text).toContain("ococ run --task");
  });
});
