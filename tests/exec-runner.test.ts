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
  kill: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.kill = vi.fn();
  return child;
}

describe("runExec", () => {
  const mockSpawn = vi.mocked(spawn);
  let originalIsTTY: boolean | undefined;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    mockSpawn.mockReset();
    originalIsTTY = process.stdin.isTTY;
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    process.env.LC_ALL = "en_US.UTF-8";
    process.env.LANG = "en_US.UTF-8";
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
    vi.useRealTimers();
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

  it("rejects absolute allow-fs specs before spawning", async () => {
    await expect(
      runExec({
        allowFsRead: [process.platform === "win32" ? "C:\\tmp" : "/tmp"],
        allowFsWrite: [],
        timeoutMs: 1000,
        maxOutputBytes: 1024,
        scriptSource: "console.log('hi');",
        scriptArgs: [],
      }),
    ).rejects.toThrow("workspace-relative");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("accepts helper source from stdin when stdin is piped", async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child as any);
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    const pending = runExec({
      allowFsRead: [],
      allowFsWrite: [],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      scriptSource: "",
      scriptArgs: [],
    });

    await Promise.resolve();
    process.stdin.emit("data", "console.log('stdin');");
    process.stdin.emit("end");
    await Promise.resolve();

    child.stdout.emit("data", Buffer.from("stdin", "utf8"));
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({
      code: 0,
      stdout: "stdin",
      truncated: false,
    });
  });

  it("kills the child and reports timeout when execution exceeds the limit", async () => {
    vi.useFakeTimers();
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child as any);

    const pending = runExec({
      allowFsRead: [],
      allowFsWrite: [],
      timeoutMs: 25,
      maxOutputBytes: 1024,
      scriptSource: "await new Promise(() => {});",
      scriptArgs: [],
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);

    const result = await pending;
    expect(result).toMatchObject({
      code: null,
      truncated: false,
    });
    expect(result.stderr).toContain("timed out");
  });

  it("kills the child and marks output as truncated when max output is exceeded", async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child as any);

    const pending = runExec({
      allowFsRead: [],
      allowFsWrite: [],
      timeoutMs: 1000,
      maxOutputBytes: 4,
      scriptSource: "console.log('hello');",
      scriptArgs: [],
    });

    await Promise.resolve();

    child.stdout.emit("data", Buffer.from("hello", "utf8"));
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);

    const result = await pending;
    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe("hell");
    expect(result.stderr).toContain("maximum collected output");
  });
});
