import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { runStatusCommand } from "../src/orchestrator-status.js";
import { runFixCommand } from "../src/orchestrator-fix.js";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

describe("status/fix task auto-resolution and suggestions", () => {
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

  it("status prints a no-tasks message when --task is omitted and no tasks exist", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-status-notasks-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    const code = await runStatusCommand({ argv: [] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("実行可能な orchestrator タスクが見つかりません");
  });

  it("status prints a multiple-tasks message when --task is omitted and multiple tasks exist", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-status-many-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    fs.mkdirSync(path.join(baseDir, "task-a", "state"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "task-b", "state"), { recursive: true });

    const code = await runStatusCommand({ argv: [] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("status には --task <タスク名> を指定してください");
  });

  it("status suggests a close match when task is misspelled in Japanese", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-status-suggest-ja-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const task = "cli-ux-i18n-and-completion";
    fs.mkdirSync(path.join(baseDir, task, "state"), { recursive: true });

    const code = await runStatusCommand({
      argv: ["--task", "cli-ux-i18n-and-completin"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("もしかして");
  });

  it("status suggests a close match when task is misspelled in English", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-status-suggest-en-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const task = "cli-ux-i18n-and-completion";
    fs.mkdirSync(path.join(baseDir, task, "state"), { recursive: true });

    const code = await runStatusCommand({
      argv: ["--task", "cli-ux-i18n-and-completin"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Did you mean");
  });

  it("fix suggests a close match when task is misspelled in Japanese", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-fix-suggest-ja-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const task = "cli-ux-i18n-and-completion";
    const stateDir = path.join(baseDir, task, "state");
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

    const code = await runFixCommand({
      argv: ["--task", "cli-ux-i18n-and-completin"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("もしかして");
  });

  it("fix suggests a close match when task is misspelled in English", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-fix-suggest-en-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const task = "cli-ux-i18n-and-completion";
    const stateDir = path.join(baseDir, task, "state");
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

    const code = await runFixCommand({
      argv: ["--task", "cli-ux-i18n-and-completin"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Did you mean");
  });
});
