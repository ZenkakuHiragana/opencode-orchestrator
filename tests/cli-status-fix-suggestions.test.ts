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

  it("status prints an unknown-task hint in Japanese when many tasks exist", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-status-unk-ja-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const now = Date.now();

    for (let i = 1; i <= 6; i += 1) {
      const task = `cli-task-${i}`;
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const time = new Date(now + i * 1000);
      fs.utimesSync(stateDir, time, time);
    }

    const code = await runStatusCommand({
      argv: ["--task", "cli-tak"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => String(c[0]));
    const text = lines.join("\n");
    expect(text).toContain("もしかして");
    const suggestLine = lines.find((l) => l.includes("もしかして"));
    expect(suggestLine).toBeDefined();
    if (!suggestLine) return;
    const afterMarker = suggestLine.split("もしかして:")[1];
    expect(afterMarker).toBeDefined();
    const tasksText = afterMarker.split("?")[0].trim();
    const taskNames = tasksText.split(",").map((s) => s.trim());
    expect(taskNames.length).toBeLessThanOrEqual(5);
    expect(taskNames[0]).toBe("cli-task-6");
    expect(taskNames[1]).toBe("cli-task-5");
    expect(text).toContain(
      "上には直近で更新されたタスクのみを表示しています。すべてのタスクを確認するには 'ococ list' を実行してください。",
    );
  });

  it("status prints an unknown-task hint in English when many tasks exist", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-status-unk-en-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const now = Date.now();

    for (let i = 1; i <= 6; i += 1) {
      const task = `cli-task-${i}`;
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const time = new Date(now + i * 1000);
      fs.utimesSync(stateDir, time, time);
    }

    const code = await runStatusCommand({
      argv: ["--task", "cli-tak"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => String(c[0]));
    const text = lines.join("\n");
    expect(text).toContain("Did you mean");
    const suggestLine = lines.find((l) => l.includes("Did you mean"));
    expect(suggestLine).toBeDefined();
    if (!suggestLine) return;
    const afterMarker = suggestLine.split("Did you mean:")[1];
    expect(afterMarker).toBeDefined();
    const tasksText = afterMarker.split("?")[0].trim();
    const taskNames = tasksText.split(",").map((s) => s.trim());
    expect(taskNames.length).toBeLessThanOrEqual(5);
    expect(taskNames[0]).toBe("cli-task-6");
    expect(taskNames[1]).toBe("cli-task-5");
    expect(text).toContain(
      "Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",
    );
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

  it("fix prints a recency-limited multiple-tasks message and list hint in Japanese when --task is omitted", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-fix-many-ja-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const now = Date.now();

    // Create 6 tasks with different mtimes so that recency ordering is deterministic.
    for (let i = 1; i <= 6; i += 1) {
      const task = `task-${i}`;
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const time = new Date(now + i * 1000);
      fs.utimesSync(stateDir, time, time);
    }

    const code = await runFixCommand({ argv: [] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => String(c[0]));
    const joined = lines.join("\n");

    // Multiple-tasks error should list only 5 tasks and include the recent ones.
    const multipleLine = lines.find((l) => l.includes("利用可能なタスク"));
    expect(multipleLine).toBeDefined();
    if (!multipleLine) return; // type narrowing for TS

    const afterMarker = multipleLine.split("利用可能なタスク:")[1];
    expect(afterMarker).toBeDefined();
    const tasksText = afterMarker.trim();
    const taskNames = tasksText.split(",").map((s) => s.trim());

    expect(taskNames.length).toBeLessThanOrEqual(5);
    expect(taskNames).toContain("task-6");
    expect(taskNames).toContain("task-5");

    // With 6 total tasks, the list-hint message should also be printed.
    expect(joined).toContain(
      "上には直近で更新されたタスクのみを表示しています。すべてのタスクを確認するには 'ococ list' を実行してください。",
    );
  });

  it("fix prints a recency-limited multiple-tasks message and list hint in English when --task is omitted", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-fix-many-en-"));
    process.env.XDG_STATE_HOME = tmpBase;
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const now = Date.now();

    for (let i = 1; i <= 6; i += 1) {
      const task = `task-${i}`;
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const time = new Date(now + i * 1000);
      fs.utimesSync(stateDir, time, time);
    }

    const code = await runFixCommand({ argv: [] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => String(c[0]));
    const joined = lines.join("\n");

    const multipleLine = lines.find((l) => l.includes("Available tasks:"));
    expect(multipleLine).toBeDefined();
    if (!multipleLine) return;

    const afterMarker = multipleLine.split("Available tasks:")[1];
    expect(afterMarker).toBeDefined();
    const tasksText = afterMarker.trim();
    const taskNames = tasksText.split(",").map((s) => s.trim());

    expect(taskNames.length).toBeLessThanOrEqual(5);
    expect(taskNames).toContain("task-6");
    expect(taskNames).toContain("task-5");

    expect(joined).toContain(
      "Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",
    );
  });
});
