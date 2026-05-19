import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCli } from "../src/cli.js";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
declare const process: { env: Record<string, string | undefined> };

describe("runCli", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  const writes: string[] = [];
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    writes.length = 0;
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
    errSpy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      writes.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    errSpy.mockRestore();
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
  });

  it("prints usage and returns 1 when no args", async () => {
    const code = await runCli([]);
    expect(code).toBe(1);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator");
  });

  it("prints help and returns 0", async () => {
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("サブコマンド:");
  });

  it("prints version and returns 0", async () => {
    const code = await runCli(["--version"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toMatch(/\d+\.\d+\.\d+/);
  });

  it("prints loop help and returns 0", async () => {
    const code = await runCli(["loop", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator loop");
  });

  it("prints list help and returns 0", async () => {
    const code = await runCli(["list", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator list");
  });

  it("prints high-level subcommand help and returns 0", async () => {
    let code = await runCli(["run", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator run");

    writes.length = 0;
    code = await runCli(["resume", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator resume");

    writes.length = 0;
    code = await runCli(["status", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator status");

    writes.length = 0;
    code = await runCli(["doctor", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator doctor");

    writes.length = 0;
    code = await runCli(["fix", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain("使い方: opencode-orchestrator fix");

    writes.length = 0;
    code = await runCli(["completion", "--help"]);
    expect(code).toBe(0);
    expect(writes.join("\n")).toContain(
      "使い方: opencode-orchestrator completion",
    );
  });

  it("prints unknown subcommand and returns 1", async () => {
    const code = await runCli(["wat"]);
    expect(code).toBe(1);
    const output = writes.join("\n");
    expect(output).toContain("不明なサブコマンドです");
    expect(output).toContain("wat");
  });

  it("returns 1 with parser errors for low-level subcommands instead of fatal wrapping", async () => {
    let code = await runCli(["list", "--foo"]);
    expect(code).toBe(1);
    expect(writes.join("\n")).toContain("unknown option for list");

    writes.length = 0;
    code = await runCli(["clear", "--resolve", "p-1"]);
    expect(code).toBe(1);
    expect(writes.join("\n")).toContain("--task");

    writes.length = 0;
    code = await runCli(["loop", "--task", "t1", "--unknown"]);
    expect(code).toBe(1);
    expect(writes.join("\n")).toContain("unknown option");
  });

  it("prints English usage when LANG is en_US.UTF-8", async () => {
    process.env.LC_ALL = "";
    process.env.LANG = "en_US.UTF-8";
    const code = await runCli([]);
    expect(code).toBe(1);
    const output = writes.join("\n");
    expect(output).toContain("Usage: opencode-orchestrator");
    expect(output).toContain("High-level subcommands (recommended):");
  });
});
