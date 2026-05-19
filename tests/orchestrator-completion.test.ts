import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

import {
  runCompleteCommand,
  runCompletionCommand,
} from "../src/orchestrator-completion.js";

describe("runCompleteCommand (__complete)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("emits completion candidates with type/value/description", async () => {
    const originalLC_ALL = process.env.LC_ALL;
    const originalLANG = process.env.LANG;

    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";

    const code = await runCompleteCommand({ argv: ["bash"] });
    expect(code).toBe(0);
    expect(lines.length).toBeGreaterThan(0);

    const parsed = lines.map(
      (l) =>
        JSON.parse(l) as {
          type: string;
          value: string;
          description: string;
        },
    );

    const subcommands = parsed.filter((c) => c.type === "subcommand");
    expect(subcommands.length).toBeGreaterThan(0);
    const runCandidate = subcommands.find((c) => c.value === "run");
    expect(runCandidate).toBeDefined();
    expect(runCandidate?.description).toContain("orchestrator loop");

    const options = parsed.filter((c) => c.type === "option");
    const taskOption = options.find((c) => c.value === "--task");
    expect(taskOption).toBeDefined();

    if (originalLC_ALL === undefined) {
      delete process.env.LC_ALL;
    } else {
      process.env.LC_ALL = originalLC_ALL;
    }
    if (originalLANG === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = originalLANG;
    }
  });

  it("localizes completion candidate descriptions based on locale", async () => {
    const originalLC_ALL = process.env.LC_ALL;
    const originalLANG = process.env.LANG;

    try {
      process.env.LC_ALL = "ja_JP.UTF-8";
      process.env.LANG = "ja_JP.UTF-8";

      const code = await runCompleteCommand({ argv: ["bash"] });
      expect(code).toBe(0);
      expect(lines.length).toBeGreaterThan(0);

      const parsed = lines.map(
        (l) =>
          JSON.parse(l) as {
            type: string;
            value: string;
            description: string;
          },
      );

      const runCandidate = parsed.find(
        (c) => c.type === "subcommand" && c.value === "run",
      );
      expect(runCandidate).toBeDefined();
      expect(runCandidate?.description).toContain("orchestrator ループ");
    } finally {
      if (originalLC_ALL === undefined) {
        delete process.env.LC_ALL;
      } else {
        process.env.LC_ALL = originalLC_ALL;
      }
      if (originalLANG === undefined) {
        delete process.env.LANG;
      } else {
        process.env.LANG = originalLANG;
      }
    }
  });

  it("suggests subcommands when completing after the CLI name", async () => {
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });

    const line = "ococ ";
    const cursor = String(line.length);
    const code = await runCompleteCommand({
      argv: ["bash", line, cursor],
    });

    expect(code).toBe(0);
    expect(lines.length).toBeGreaterThan(0);

    const parsed = lines.map((l) => JSON.parse(l) as any);
    expect(parsed.every((c) => c.type === "subcommand")).toBe(true);

    logSpy.mockRestore();
  });

  it("suggests options when completing after a high-level subcommand and '--'", async () => {
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });

    const line = "ococ run --";
    const cursor = String(line.length);
    const code = await runCompleteCommand({
      argv: ["bash", line, cursor],
    });

    expect(code).toBe(0);
    expect(lines.length).toBeGreaterThan(0);

    const parsed = lines.map((l) => JSON.parse(l) as any);
    expect(parsed.every((c) => c.type === "option")).toBe(true);
    const hasTask = parsed.some((c) => c.value === "--task");
    expect(hasTask).toBe(true);
    expect(parsed.some((c) => c.value === "--commit")).toBe(true);
    expect(parsed.some((c) => c.value === "--max-loop")).toBe(true);

    logSpy.mockRestore();
  });

  it("suggests low-level list options for list subcommand", async () => {
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });

    const line = "ococ list --";
    const cursor = String(line.length);
    const code = await runCompleteCommand({
      argv: ["bash", line, cursor],
    });

    expect(code).toBe(0);
    const parsed = lines.map((l) => JSON.parse(l) as any);
    expect(parsed.some((c) => c.value === "--json")).toBe(true);
    expect(parsed.some((c) => c.value === "--proposals")).toBe(true);
    expect(parsed.some((c) => c.value === "--open")).toBe(true);

    logSpy.mockRestore();
  });

  it("suggests supported shell names for the completion subcommand", async () => {
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.map((a) => String(a)).join(" "));
    });

    const line = "ococ completion ";
    const cursor = String(line.length);
    const code = await runCompleteCommand({
      argv: ["bash", line, cursor],
    });

    expect(code).toBe(0);
    const parsed = lines.map((l) => JSON.parse(l) as any);
    expect(parsed.some((c) => c.value === "bash")).toBe(true);
    expect(parsed.some((c) => c.value === "powershell")).toBe(true);

    logSpy.mockRestore();
  });

  it("suggests task names when completing the value for --task", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-complete-task-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    try {
      const task = "demo-task";
      const stateDir = path.join(
        tmpBase,
        "opencode",
        "orchestrator",
        task,
        "state",
      );
      fs.mkdirSync(stateDir, { recursive: true });

      const lines: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
        lines.push(args.map((a) => String(a)).join(" "));
      });

      const line = "ococ run --task ";
      const cursor = String(line.length);
      const code = await runCompleteCommand({
        argv: ["bash", line, cursor],
      });

      expect(code).toBe(0);
      expect(lines.length).toBeGreaterThan(0);

      const parsed = lines.map((l) => JSON.parse(l) as any);
      expect(parsed.every((c) => c.type === "task")).toBe(true);
      const hasDemoTask = parsed.some((c) => c.value === task);
      expect(hasDemoTask).toBe(true);

      logSpy.mockRestore();
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = originalXdg;
      }
    }
  });

  it("suggests task names when completing the value for -t", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const tmpBase = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-complete-task-short-"),
    );
    process.env.XDG_STATE_HOME = tmpBase;

    try {
      const task = "demo-task-short";
      const stateDir = path.join(
        tmpBase,
        "opencode",
        "orchestrator",
        task,
        "state",
      );
      fs.mkdirSync(stateDir, { recursive: true });

      const lines: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
        lines.push(args.map((a) => String(a)).join(" "));
      });

      const line = "ococ run -t ";
      const cursor = String(line.length);
      const code = await runCompleteCommand({
        argv: ["bash", line, cursor],
      });

      expect(code).toBe(0);
      const parsed = lines.map((l) => JSON.parse(l) as any);
      expect(parsed.every((c) => c.type === "task")).toBe(true);
      expect(parsed.some((c) => c.value === task)).toBe(true);

      logSpy.mockRestore();
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = originalXdg;
      }
    }
  });
});

describe("runCompletionCommand (completion)", () => {
  it("rejects unsupported shell names instead of silently failing", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runCompletionCommand({ argv: ["zsh"] });

    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it("emits a bash completion script that calls __complete with line and cursor", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await runCompletionCommand({ argv: ["bash"] });

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);

    const script = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(script).toContain("_ococ_completion");
    expect(script).toContain("__complete bash");
    expect(script).toContain("COMP_LINE");
    expect(script).toContain("COMP_POINT");

    logSpy.mockRestore();
  });

  it("emits a PowerShell completion script that calls __complete with command line and cursor", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const code = await runCompletionCommand({ argv: ["powershell"] });

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);

    const script = String(logSpy.mock.calls[0]?.[0] ?? "");
    expect(script).toContain("Register-ArgumentCompleter");
    expect(script).toContain("__complete powershell");
    expect(script).toContain("$cursorPosition");

    logSpy.mockRestore();
  });

  it("localizes bash completion script header based on locale", async () => {
    const originalLC_ALL = process.env.LC_ALL;
    const originalLANG = process.env.LANG;

    try {
      process.env.LC_ALL = "ja_JP.UTF-8";
      process.env.LANG = "ja_JP.UTF-8";

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const code = await runCompletionCommand({ argv: ["bash"] });

      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledTimes(1);

      const script = String(logSpy.mock.calls[0]?.[0] ?? "");
      expect(script).toContain(
        "# ococ / opencode-orchestrator 用 bash 補完設定",
      );

      logSpy.mockRestore();
    } finally {
      if (originalLC_ALL === undefined) {
        delete process.env.LC_ALL;
      } else {
        process.env.LC_ALL = originalLC_ALL;
      }
      if (originalLANG === undefined) {
        delete process.env.LANG;
      } else {
        process.env.LANG = originalLANG;
      }
    }
  });
});
