import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { parseListArgs, runList } from "../src/cli.js";

const helperAvailability = {
  "helper:grep": "available",
  "helper:rg": "available",
  "helper:sort": "available",
  "helper:sort-with-flags": "available",
  "helper:uniq": "available",
  "helper:uniq-with-flags": "available",
  "helper:wc": "available",
  "helper:head": "available",
  "helper:tail": "available",
  "helper:cut": "available",
  "helper:tr": "available",
  "helper:comm": "available",
  "helper:cat": "available",
  "helper:ls": "available",
  "helper:jq": "available",
  "helper:true": "available",
  "helper:false": "available",
  "helper:test": "available",
  "helper:bracket": "available",
} as const;

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

  beforeEach(() => {
    console.error = vi.fn();
    console.log = vi.fn();
  });

  it("prints a friendly message when proposals are requested but none exist", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const fakeXdg = path.join(
      os.tmpdir(),
      `opencode-orch-prop-none-${Date.now().toString(16)}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const baseDir = path.join(fakeXdg, "opencode", "orchestrator");
    const task = "no-proposals-task";
    const stateDir = path.join(baseDir, task, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    await runList({ format: "text", task, showProposals: true });

    process.env.XDG_STATE_HOME = originalXdg;

    const errorMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const errorCalls = errorMock.mock.calls
      .map((args: unknown[]) => args.join(" "))
      .join("\n");
    expect(errorCalls).toContain(`タスク "${task}" に proposal はありません。`);
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("prints a friendly message when base directory does not exist", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const fakeXdg = path.join(
      os.tmpdir(),
      `opencode-orch-missing-${Date.now().toString(16)}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    await runList({ format: "text" });

    process.env.XDG_STATE_HOME = originalXdg;

    const errorMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const errorCalls = errorMock.mock.calls
      .map((args: unknown[]) => args.join(" "))
      .join("\n");
    expect(errorCalls).toContain(
      "orchestrator タスク用のベースディレクトリが存在しません",
    );
    const logMock = console.log as unknown as { mock: { calls: unknown[][] } };
    expect(logMock.mock.calls.length).toBe(0);
  });
});

describe("runList integration", () => {
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("lists tasks in json format when state exists", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const fakeXdg = path.join(
      os.tmpdir(),
      `opencode-orch-json-${Date.now().toString(16)}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    process.env.XDG_STATE_HOME = fakeXdg;

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
          helper_availability: helperAvailability,
        },
        commands: [],
      }),
      "utf8",
    );

    await runList({ format: "json" });

    process.env.XDG_STATE_HOME = originalXdg;
    try {
      fs.rmSync(fakeXdg, { recursive: true, force: true });
    } catch {
      // ignore
    }

    const logMock = console.log as unknown as { mock: { calls: unknown[][] } };
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

  it("reads summary from acceptance-index north_star in json format", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const fakeXdg = path.join(
      os.tmpdir(),
      `opencode-orch-summary-json-${Date.now().toString(16)}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    process.env.XDG_STATE_HOME = fakeXdg;

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

    process.env.XDG_STATE_HOME = originalXdg;
    try {
      fs.rmSync(fakeXdg, { recursive: true, force: true });
    } catch {
      // ignore
    }

    const logMock = console.log as unknown as { mock: { calls: unknown[][] } };
    const jsonText = String(logMock.mock.calls[0][0]);
    const parsed = JSON.parse(jsonText) as { summary: string | null }[];

    expect(parsed[0].summary).toBe(
      "Ship a compact task summary for list output.",
    );
  });

  it("aligns columns in text format when multiple tasks have different statuses", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const fakeXdg = path.join(
      os.tmpdir(),
      `opencode-orch-cols-${Date.now().toString(16)}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    process.env.XDG_STATE_HOME = fakeXdg;

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
          helper_availability: helperAvailability,
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
          helper_availability: helperAvailability,
        },
        commands: [],
      }),
      "utf8",
    );

    await runList({ format: "text" });

    process.env.XDG_STATE_HOME = originalXdg;
    try {
      fs.rmSync(fakeXdg, { recursive: true, force: true });
    } catch {
      // ignore
    }

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

    // Both lines should have "loop_status=" at the same column position
    const alphaStatusPos = alphaLine.indexOf("loop_status=");
    const longStatusPos = longLine.indexOf("loop_status=");
    expect(alphaStatusPos).toBe(longStatusPos);

    // Verify the alpha line has padding between task name and status
    expect(alphaLine).toMatch(/^alpha\s+loop_status=ready_for_loop\s*$/);
    expect(longLine).toMatch(
      /^long-task-name\s+loop_status=needs_refinement\s*$/,
    );
  });

  it("omits loop_status column when no task has it", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const fakeXdg = path.join(
      os.tmpdir(),
      `opencode-orch-nos-${Date.now().toString(16)}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const nosBaseDir = path.join(fakeXdg, "opencode", "orchestrator");
    const nosStateDir = path.join(nosBaseDir, "task-a", "state");
    fs.mkdirSync(nosStateDir, { recursive: true });
    // No command-policy.json — loop_status stays undefined

    await runList({ format: "text" });

    process.env.XDG_STATE_HOME = originalXdg;
    try {
      fs.rmSync(fakeXdg, { recursive: true, force: true });
    } catch {
      // ignore
    }

    const nosLogMock = console.log as unknown as {
      mock: { calls: unknown[][] };
    };
    const nosLines = nosLogMock.mock.calls.map((c: unknown[]) => String(c[0]));

    expect(nosLines.length).toBe(1);
    expect(nosLines[0]).toBe("task-a");
    expect(nosLines[0]).not.toContain("loop_status");
  });

  it("shows summary column in text format and falls back to spec goal", async () => {
    const originalXdg = process.env.XDG_STATE_HOME;
    const fakeXdg = path.join(
      os.tmpdir(),
      `opencode-orch-summary-text-${Date.now().toString(16)}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    process.env.XDG_STATE_HOME = fakeXdg;

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

    process.env.XDG_STATE_HOME = originalXdg;
    try {
      fs.rmSync(fakeXdg, { recursive: true, force: true });
    } catch {
      // ignore
    }

    const logMock = console.log as unknown as { mock: { calls: unknown[][] } };
    const lines = logMock.mock.calls.map((c: unknown[]) => String(c[0]));

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("summary=Alpha summary from north star.");
    expect(lines[1]).toContain("summary=Beta summary from spec goal section.");

    const alphaSummaryPos = lines[0].indexOf("summary=");
    const betaSummaryPos = lines[1].indexOf("summary=");
    expect(alphaSummaryPos).toBe(betaSummaryPos);
  });
});
