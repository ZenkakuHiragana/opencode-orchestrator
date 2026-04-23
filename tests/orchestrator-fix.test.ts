import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runFixCommand } from "../src/orchestrator-fix.js";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

describe("runFixCommand planning diagnostics", () => {
  const originalError = console.error;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;
  let prevXdg: string | undefined;

  beforeEach(() => {
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    prevXdg = process.env.XDG_STATE_HOME;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
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

  it("prints a planning-blocked message when command-policy.loop_status=needs_refinement", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-fix-plan-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "cli-ux-i18n-and-completion";
    const stateDir = path.join(
      tmpBase,
      "opencode",
      "orchestrator",
      task,
      "state",
    );
    fs.mkdirSync(stateDir, { recursive: true });
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

    const code = await runFixCommand({ argv: ["--task", task] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain(
      "このタスクはまだ計画フェーズや事前チェックの結果から実行可能な状態ではありません",
    );
  });

  it("prints an env-blocked message when command-policy.loop_status=blocked_by_environment", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-fix-env-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "cli-ux-i18n-and-completion";
    const stateDir = path.join(
      tmpBase,
      "opencode",
      "orchestrator",
      task,
      "state",
    );
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "command-policy.json"),
      JSON.stringify(
        {
          version: 1,
          summary: {
            loop_status: "blocked_by_environment",
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await runFixCommand({ argv: ["--task", task] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain(
      "このタスクは環境要因 (必要なコマンドが利用できない・実行できない など) によって実行できない状態です",
    );
  });

  it("prints an execution-ready message when the task can be run", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-fix-ready-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "cli-ux-i18n-and-completion";
    const stateDir = path.join(
      tmpBase,
      "opencode",
      "orchestrator",
      task,
      "state",
    );
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

    const code = await runFixCommand({ argv: ["--task", task] });

    expect(code).toBe(0);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("このタスクは実行可能な状態です");
    expect(text).toContain(`ococ run --task ${task}`);
  });

  it("surfaces the latest failed audit requirements when planning state is unknown", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-fix-audit-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const task = "cli-ux-i18n-and-completion";
    const stateDir = path.join(
      tmpBase,
      "opencode",
      "orchestrator",
      task,
      "state",
    );
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "status.json"),
      JSON.stringify(
        {
          version: 1,
          last_auditor_report: {
            cycle: 7,
            audit_mode: "final_full",
            done: false,
            requirements: [
              {
                id: "R1",
                passed: false,
                reason:
                  "Missing verification evidence for the final acceptance path",
              },
            ],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await runFixCommand({ argv: ["--task", task] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("未達要件が残っています: R1");
    expect(text).toContain(
      "Missing verification evidence for the final acceptance path",
    );
  });
});
