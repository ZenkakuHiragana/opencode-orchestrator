import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { parseListArgs, runList } from "../src/cli.js";

describe("parseListArgs", () => {
  it("defaults to text format with no args", () => {
    const opts = parseListArgs([]);
    expect(opts.format).toBe("text");
  });

  it("enables json format with --json", () => {
    const opts = parseListArgs(["--json"]);
    expect(opts.format).toBe("json");
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
      "no orchestrator tasks found; base directory does not exist",
    );
    const logMock = console.log as unknown as { mock: { calls: unknown[][] } };
    expect(logMock.mock.calls.length).toBe(0);
  });
});

describe("runList integration", () => {
  const originalConsoleLog = console.log;

  beforeEach(() => {
    console.log = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
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
      JSON.stringify({ summary: { loop_status: "ready_for_loop" } }),
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
      title: string | null;
    }[];

    expect(parsed.length).toBe(1);
    expect(parsed[0].task).toBe(task);
    expect(parsed[0].loop_status).toBe("ready_for_loop");
    expect(parsed[0].title).toBeNull();
  });
});
