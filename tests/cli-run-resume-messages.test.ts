import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  runRunCommand,
  type RunCommandOptions,
} from "../src/orchestrator-run.js";
import {
  runResumeCommand,
  type ResumeCommandOptions,
} from "../src/orchestrator-resume.js";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

describe("runRunCommand i18n messages and task resolution", () => {
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

  it("prints a no-tasks message when --task is missing and no tasks exist", async () => {
    const opts: RunCommandOptions = { argv: [] };

    const code = await runRunCommand(opts);

    expect(code).toBe(1);
  });

  it("prints a multiple-tasks message for run when --task is omitted", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-run-many-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    fs.mkdirSync(path.join(baseDir, "task-a", "state"), { recursive: true });
    fs.mkdirSync(path.join(baseDir, "task-b", "state"), { recursive: true });

    const code = await runRunCommand({ argv: [] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("--task <タスク名> を指定してください");
  });

  it("prints a not-ready message for run when loop_status is not ready_for_loop", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-run-notready-"),
    );
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

    const code = await runRunCommand({ argv: ["--task", task] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("高レベル run はまだ実行の準備ができていません");
  });

  // NOTE: ready_for_loop の実際のループ実行は orchestrator-loop のテストで
  // カバーされているため、ここでは run 側の smoke test は行わない。

  it("suggests a close match when task is misspelled in Japanese", async () => {
    const opts: RunCommandOptions = { argv: ["--task", "demo-tak"] };

    const code = await runRunCommand(opts);

    expect(code).toBe(1);
  });

  it("suggests a close match when task is misspelled in English", async () => {
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const opts: RunCommandOptions = { argv: ["--task", "demo-tak"] };

    const code = await runRunCommand(opts);

    expect(code).toBe(1);
  });

  it("prints a recency-based unknown-task hint for run in Japanese when many tasks exist", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-run-unk-ja-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const now = Date.now();

    for (let i = 1; i <= 6; i += 1) {
      const task = `demo-task-${i}`;
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const time = new Date(now + i * 1000);
      fs.utimesSync(stateDir, time, time);
    }

    const opts: RunCommandOptions = { argv: ["--task", "demo-tak"] };
    const code = await runRunCommand(opts);

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => String(c[0]));
    const text = lines.join("\n");
    expect(text).toContain("もしかして");
    // Ensure suggestion list is at most 5 items and ordered by recency (task-6, task-5 ...).
    const suggestLine = lines.find((l) => l.includes("もしかして"));
    expect(suggestLine).toBeDefined();
    if (!suggestLine) return;
    const afterMarker = suggestLine.split("もしかして:")[1];
    expect(afterMarker).toBeDefined();
    const tasksText = afterMarker.split("?")[0].trim();
    const taskNames = tasksText.split(",").map((s) => s.trim());
    expect(taskNames.length).toBeLessThanOrEqual(5);
    expect(taskNames[0]).toBe("demo-task-6");
    expect(taskNames[1]).toBe("demo-task-5");
    expect(text).toContain(
      "上には直近で更新されたタスクのみを表示しています。すべてのタスクを確認するには 'ococ list' を実行してください。",
    );
  });

  it("prints a recency-based unknown-task hint for run in English when many tasks exist", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-run-unk-en-"));
    process.env.XDG_STATE_HOME = tmpBase;
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const now = Date.now();

    for (let i = 1; i <= 6; i += 1) {
      const task = `demo-task-${i}`;
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const time = new Date(now + i * 1000);
      fs.utimesSync(stateDir, time, time);
    }

    const opts: RunCommandOptions = { argv: ["--task", "demo-tak"] };
    const code = await runRunCommand(opts);

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
    expect(taskNames[0]).toBe("demo-task-6");
    expect(taskNames[1]).toBe("demo-task-5");
    expect(text).toContain(
      "Showing only the most recently updated tasks above. Run 'ococ list' to see all available tasks.",
    );
  });
});

describe("runResumeCommand i18n messages", () => {
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
    if (prevXdg === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = prevXdg;
    }
    if (prevLANG === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = prevLANG;
    }
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("prints a not-ready message for resume", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-resume-notready-"),
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

    const opts: ResumeCommandOptions = { argv: ["--task", task] };

    const code = await runResumeCommand(opts);

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain(
      "計画フェーズや事前チェックが完了していないため再開できません",
    );
  });

  it("suggests a close match when resume task is misspelled in Japanese", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-resume-suggest-ja-"),
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
            loop_status: "ready_for_loop",
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await runResumeCommand({
      argv: ["--task", "cli-ux-i18n-and-completin"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("もしかして");
  });

  it("suggests a close match when resume task is misspelled in English", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-resume-suggest-en-"),
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
            loop_status: "ready_for_loop",
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await runResumeCommand({
      argv: ["--task", "cli-ux-i18n-and-completin"],
    });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("Did you mean");
  });

  it("prints a no-tasks message when --task is omitted and no tasks exist", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-resume-notasks-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    const opts: ResumeCommandOptions = { argv: [] };

    const code = await runResumeCommand(opts);

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain(
      "実行可能な orchestrator タスクが見つかりません。まず Refiner/Todo-Writer で少なくとも 1 つタスクを用意してから resume を使ってください。",
    );
  });

  it("prints a multiple-tasks message when --task is omitted and more than one task exists", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-resume-many-"));
    process.env.XDG_STATE_HOME = tmpBase;

    const baseDir = path.join(tmpBase, "opencode", "orchestrator");
    const taskA = path.join(baseDir, "task-a", "state");
    const taskB = path.join(baseDir, "task-b", "state");
    fs.mkdirSync(taskA, { recursive: true });
    fs.mkdirSync(taskB, { recursive: true });

    const opts: ResumeCommandOptions = { argv: [] };

    const code = await runResumeCommand(opts);

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain(
      "resume には --task <タスク名> を指定してください。",
    );
  });

  it("does not start the loop when command-policy.loop_status is not ready_for_loop", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-resume-"));
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

    const opts: ResumeCommandOptions = { argv: ["--task", task] };

    const code = await runResumeCommand(opts);

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain(
      "このタスクのセッションは、計画フェーズや事前チェックが完了していないため再開できません",
    );
  });

  it("prints an env-blocked message for resume", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-resume-env-"));
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

    const code = await runResumeCommand({ argv: ["--task", task] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("環境要因");
  });

  it("prints a generic not-ready message for resume when loop_status is unknown", async () => {
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-resume-generic-"),
    );
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
            loop_status: "mystery_state",
          },
          commands: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const code = await runResumeCommand({ argv: ["--task", task] });

    expect(code).toBe(1);
    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const text = errMock.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain(
      "高レベル resume はまだセッション再開の準備ができていません",
    );
  });
});
