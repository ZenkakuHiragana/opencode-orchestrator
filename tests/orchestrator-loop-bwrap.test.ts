import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoopOptions } from "../src/cli-args.js";
import { runLoop } from "../src/orchestrator-loop.js";
import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

const baseOpts: LoopOptions = {
  task: "test-task-bwrap",
  maxLoop: 1,
  maxRestarts: 0,
  files: [],
  prompt: "test",
  sessionId: undefined,
  continueLast: false,
  commitOnDone: false,
  dangerouslySkipCommandPolicy: false,
  bwrapSkipCommandPolicy: true,
  bwrapArgs: [],
};

describe("runLoop bwrap preflight", () => {
  const originalXdg = process.env.XDG_STATE_HOME;
  const originalPlatform = process.platform;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
  });

  afterEach(() => {
    process.env.XDG_STATE_HOME = originalXdg;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
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
    vi.restoreAllMocks();
  });

  it("rejects mutually exclusive dangerous flags", async () => {
    await expect(
      runLoop({
        ...baseOpts,
        dangerouslySkipCommandPolicy: true,
        bwrapSkipCommandPolicy: true,
      }),
    ).rejects.toThrow("同時には指定できません");
  });

  it("fails clearly when bwrap is unavailable", async () => {
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as any);

    const fakeXdg = fs.mkdtempSync(path.join(os.tmpdir(), "orch-loop-bwrap-"));
    process.env.XDG_STATE_HOME = fakeXdg;
    const stateDir = getOrchestratorStateDir(baseOpts.task);
    fs.mkdirSync(stateDir, { recursive: true });

    await expect(runLoop(baseOpts)).rejects.toThrow("bwrap");
  });

  it("fails clearly when the bwrap dry run cannot initialize", async () => {
    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as any)
      .mockReturnValueOnce({ status: 1 } as any);

    const fakeXdg = fs.mkdtempSync(path.join(os.tmpdir(), "orch-loop-bwrap-"));
    process.env.XDG_STATE_HOME = fakeXdg;
    const stateDir = getOrchestratorStateDir(baseOpts.task);
    fs.mkdirSync(stateDir, { recursive: true });

    await expect(runLoop(baseOpts)).rejects.toThrow(
      "サンドボックス初期化に失敗",
    );
  });

  it("ignores bwrap mode on Windows and falls back to the normal gate", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    const fakeXdg = fs.mkdtempSync(path.join(os.tmpdir(), "orch-loop-bwrap-"));
    process.env.XDG_STATE_HOME = fakeXdg;
    const stateDir = getOrchestratorStateDir(baseOpts.task);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "command-policy.json"),
      JSON.stringify(
        {
          version: 1,
          summary: {
            loop_status: "needs_refinement",
            available_helper_commands: ["grep"],
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

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runLoop(baseOpts)).rejects.toThrow();
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "Windows 環境ではサポートされていないため無視されます",
    );
  });
});
