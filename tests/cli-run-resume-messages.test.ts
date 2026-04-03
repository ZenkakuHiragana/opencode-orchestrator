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
});
