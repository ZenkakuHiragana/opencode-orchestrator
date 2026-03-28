import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";

import { runExec } from "../src/exec-runner.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: (value?: string) => void };
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  return child;
}

describe("runExec", () => {
  const mockSpawn = vi.mocked(spawn);
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    mockSpawn.mockReset();
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  });

  it("spawns node with permission flags and combined script", async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child as any);

    const pending = runExec({
      allowFsRead: ["src/**"],
      allowFsWrite: ["artifacts/**"],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      scriptSource: "console.log(argv.join(','));",
      scriptArgs: ["a", "b"],
    });

    await Promise.resolve();

    child.stdout.emit("data", Buffer.from("out", "utf8"));
    child.stderr.emit("data", Buffer.from("err", "utf8"));
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({
      code: 0,
      stdout: "out",
      stderr: "err",
      truncated: false,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args] = mockSpawn.mock.calls[0] as any;
    expect(command).toBe(process.execPath);
    expect(args).toContain("--input-type=module");
    expect(args.join(" ")).toContain("--allow-fs-read=");
    expect(args.join(" ")).toContain("--allow-fs-write=");
  });
});
