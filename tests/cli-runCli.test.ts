import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { runCli } from "../src/cli.js";

describe("runCli", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  const writes: string[] = [];

  beforeEach(() => {
    writes.length = 0;
    errSpy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      writes.push(args.map((a) => String(a)).join(" "));
    });
  });

  afterEach(() => {
    errSpy.mockRestore();
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

  it("prints unknown subcommand and returns 1", async () => {
    const code = await runCli(["wat"]);
    expect(code).toBe(1);
    expect(writes.join("\n")).toContain("unknown subcommand");
  });
});
