import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { parseListArgs, runList } from "../src/cli.js";

const availableHelperCommands = [
  "grep",
  "rg",
  "sort",
  "uniq",
  "wc",
  "head",
  "tail",
  "cut",
  "tr",
  "comm",
  "cat",
  "ls",
  "jq",
  "true",
  "false",
  "test",
  "[",
] as const;

async function withTempXdgStateHome<T>(
  prefix: string,
  callback: (fakeXdg: string) => Promise<T>,
): Promise<T> {
  const originalXdg = process.env.XDG_STATE_HOME;
  const fakeXdg = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`,
  );
  process.env.XDG_STATE_HOME = fakeXdg;

  try {
    return await callback(fakeXdg);
  } finally {
    process.env.XDG_STATE_HOME = originalXdg;
    try {
      fs.rmSync(fakeXdg, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

describe("parseListArgs", () => {
  it("defaults to text format with no args", () => {
    const opts = parseListArgs([]);
    expect(opts.format).toBe("text");
  });

  it("enables json format with --json", () => {
    const opts = parseListArgs(["--json"]);
    expect(opts.format).toBe("json");
  });

  it("accepts --task and --proposals", () => {
    const opts = parseListArgs(["--task", "foo", "--proposals"]);
    expect(opts.task).toBe("foo");
    expect(opts.showProposals).toBe(true);
  });

  it("throws on unknown option", () => {
    expect(() => parseListArgs(["--unknown"])).toThrow(
      /unknown option for list/,
    );
  });

  it("throws on unexpected positional argument", () => {
    expect(() => parseListArgs(["extra"])).toThrow(
      /unexpected argument for list/,
    );
  });
});

describe("runList", () => {
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    console.error = vi.fn();
    console.log = vi.fn();
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
  });

  it("prints a friendly message when proposals are requested but none exist", async () => {
    await withTempXdgStateHome("opencode-orch-prop-none", async (fakeXdg) => {
      const baseDir = path.join(fakeXdg, "opencode", "orchestrator");
      const task = "no-proposals-task";
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });

      await runList({ format: "text", task, showProposals: true });

      const errorMock = console.error as unknown as {
        mock: { calls: unknown[][] };
      };
      const errorCalls = errorMock.mock.calls
        .map((args: unknown[]) => args.join(" "))
        .join("\n");
      expect(errorCalls).toContain(
        `タスク "${task}" に proposal はありません。`,
      );
    });
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
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
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("prints a friendly message when base directory does not exist", async () => {
    await withTempXdgStateHome("opencode-orch-missing", async () => {
      await runList({ format: "text" });

      const errorMock = console.error as unknown as {
        mock: { calls: unknown[][] };
      };
      const errorCalls = errorMock.mock.calls
        .map((args: unknown[]) => args.join(" "))
        .join("\n");
      expect(errorCalls).toContain(
        "orchestrator タスク用のベースディレクトリが存在しません",
      );
      const logMock = console.log as unknown as {
        mock: { calls: unknown[][] };
      };
      expect(logMock.mock.calls.length).toBe(0);
    });
  });
});

describe("runList integration", () => {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    console.log = vi.fn();
    console.error = vi.fn();
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
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
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("lists tasks in json format when state exists", async () => {
    await withTempXdgStateHome("opencode-orch-json", async (fakeXdg) => {
      const baseDir = path.join(fakeXdg, "opencode", "orchestrator");
      const task = "my-task";
      const stateDir = path.join(baseDir, task, "state");
      fs.mkdirSync(stateDir, { recursive: true });

      const policyPath = path.join(stateDir, "command-policy.json");
      fs.writeFileSync(
        policyPath,
        JSON.stringify({
          version: 1,
          summary: {
            loop_status: "ready_for_loop",
            available_helper_commands: availableHelperCommands.slice(),
          },
          commands: [],
        }),
        "utf8",
      );

      await runList({ format: "json" });

      const logMock = console.log as unknown as {
        mock: { calls: unknown[][] };
      };
      expect(logMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      const jsonText = String(logMock.mock.calls[0][0]);
      const parsed = JSON.parse(jsonText) as {
        task: string;
        loop_status: string | null;
        summary: string | null;
      }[];

      expect(parsed.length).toBe(1);
      expect(parsed[0].task).toBe(task);
      expect(parsed[0].loop_status).toBe("ready_for_loop");
      expect(parsed[0].summary).toBeNull();
    });
  });

  it("reads summary from acceptance-index north_star in json format", async () => {
    await withTempXdgStateHome(
      "opencode-orch-summary-json",
      async (fakeXdg) => {
        const baseDir = path.join(fakeXdg, "opencode", "orchestrator");
        const task = "summary-task";
        const stateDir = path.join(baseDir, task, "state");
        fs.mkdirSync(stateDir, { recursive: true });

        fs.writeFileSync(
          path.join(stateDir, "acceptance-index.json"),
          JSON.stringify({
            version: 1,
            north_star: "Ship a compact task summary for list output.",
            requirements: [],
          }),
          "utf8",
        );

        await runList({ format: "json" });

        const logMock = console.log as unknown as {
          mock: { calls: unknown[][] };
        };
        const jsonText = String(logMock.mock.calls[0][0]);
        const parsed = JSON.parse(jsonText) as { summary: string | null }[];

        expect(parsed[0].summary).toBe(
          "Ship a compact task summary for list output.",
        );
      },
    );
  });

  it("aligns status column in text format when multiple tasks have different statuses", async () => {
    await withTempXdgStateHome("opencode-orch-cols", async (fakeXdg) => {
      const colsBaseDir = path.join(fakeXdg, "opencode", "orchestrator");

      // Task with short name
      const shortDir = path.join(colsBaseDir, "alpha", "state");
      fs.mkdirSync(shortDir, { recursive: true });
      fs.writeFileSync(
        path.join(shortDir, "command-policy.json"),
        JSON.stringify({
          version: 1,
          summary: {
            loop_status: "ready_for_loop",
            available_helper_commands: availableHelperCommands.slice(),
          },
          commands: [],
        }),
        "utf8",
      );

      // Task with longer name and different status
      const longDir = path.join(colsBaseDir, "long-task-name", "state");
      fs.mkdirSync(longDir, { recursive: true });
      fs.writeFileSync(
        path.join(longDir, "command-policy.json"),
        JSON.stringify({
          version: 1,
          summary: {
            loop_status: "needs_refinement",
            available_helper_commands: availableHelperCommands.slice(),
          },
          commands: [],
        }),
        "utf8",
      );

      await runList({ format: "text" });

      const colsLogMock = console.log as unknown as {
        mock: { calls: unknown[][] };
      };
      const colsLines = colsLogMock.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );

      expect(colsLines.length).toBe(2);

      // "alpha" is padded to match "long-task-name" length (14 chars)
      const alphaLine = colsLines[0];
      const longLine = colsLines[1];

      // Both lines should have status text at the same column position
      const alphaStatusPos = alphaLine.indexOf("実行可能");
      const longStatusPos = longLine.indexOf("計画の見直しが必要");
      expect(alphaStatusPos).toBe(longStatusPos);

      // Verify the alpha line has padding between task name and status text
      expect(alphaLine).toMatch(/^alpha\s+実行可能\s*$/);
      expect(longLine).toMatch(/^long-task-name\s+計画の見直しが必要\s*$/);
    });
  });

  it("omits loop_status column when no task has it", async () => {
    await withTempXdgStateHome("opencode-orch-nos", async (fakeXdg) => {
      const nosBaseDir = path.join(fakeXdg, "opencode", "orchestrator");
      const nosStateDir = path.join(nosBaseDir, "task-a", "state");
      fs.mkdirSync(nosStateDir, { recursive: true });
      // No command-policy.json — loop_status stays undefined

      await runList({ format: "text" });

      const nosLogMock = console.log as unknown as {
        mock: { calls: unknown[][] };
      };
      const nosLines = nosLogMock.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );

      expect(nosLines.length).toBe(1);
      expect(nosLines[0]).toBe("task-a");
      expect(nosLines[0]).not.toContain("loop_status");
    });
  });

  it("shows summary column in text format and falls back to spec goal", async () => {
    await withTempXdgStateHome(
      "opencode-orch-summary-text",
      async (fakeXdg) => {
        const baseDir = path.join(fakeXdg, "opencode", "orchestrator");

        const northStarDir = path.join(baseDir, "alpha", "state");
        fs.mkdirSync(northStarDir, { recursive: true });
        fs.writeFileSync(
          path.join(northStarDir, "acceptance-index.json"),
          JSON.stringify({
            version: 1,
            north_star: "Alpha summary from north star.",
            requirements: [],
          }),
          "utf8",
        );

        const specFallbackDir = path.join(baseDir, "beta", "state");
        fs.mkdirSync(specFallbackDir, { recursive: true });
        fs.writeFileSync(
          path.join(specFallbackDir, "spec.md"),
          [
            "# beta タスク仕様",
            "",
            "## 目標",
            "",
            "Beta summary from spec goal section.",
            "",
            "## 非目標",
            "",
            "- none",
          ].join("\n"),
          "utf8",
        );

        await runList({ format: "text" });

        const logMock = console.log as unknown as {
          mock: { calls: unknown[][] };
        };
        const lines = logMock.mock.calls.map((c: unknown[]) => String(c[0]));

        expect(lines.length).toBe(2);
        expect(lines[0]).toContain("Alpha summary from north star.");
        expect(lines[1]).toContain("Beta summary from spec goal section.");

        const alphaSummaryPos = lines[0].indexOf(
          "Alpha summary from north star.",
        );
        const betaSummaryPos = lines[1].indexOf(
          "Beta summary from spec goal section.",
        );
        expect(alphaSummaryPos).toBe(betaSummaryPos);
      },
    );
  });
});
