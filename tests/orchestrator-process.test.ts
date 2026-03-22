import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";

import { runOpencode } from "../src/orchestrator-process.js";
import { buildOpencodeSpawnPlan } from "../src/opencode-spawn.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("runOpencode", () => {
  const mockSpawn = vi.mocked(spawn);
  const originalOpencodeBin = process.env.OPENCODE_BIN;

  beforeEach(() => {
    mockSpawn.mockReset();
    if (originalOpencodeBin === undefined) {
      delete process.env.OPENCODE_BIN;
    } else {
      process.env.OPENCODE_BIN = originalOpencodeBin;
    }
  });

  it("spawns plain opencode by default", async () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child as any);

    const pending = runOpencode(["--version"], undefined, false);
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({
      code: 0,
      stdout: "",
      stderr: "",
    });

    const plan = buildOpencodeSpawnPlan("opencode", ["--version"]);
    expect(mockSpawn).toHaveBeenCalledWith(plan.command, plan.args, {
      shell: plan.shell,
      stdio: ["inherit", "pipe", "pipe"],
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });
  });

  it("uses OPENCODE_BIN when provided", async () => {
    process.env.OPENCODE_BIN = "opencode.cmd";

    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child as any);

    const pending = runOpencode(["run", "--help"], undefined, false);
    child.stdout.emit("data", Buffer.from("ok", "utf8"));
    child.stderr.emit("data", Buffer.from("warn", "utf8"));
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({
      code: 0,
      stdout: "ok",
      stderr: "warn",
    });

    const plan = buildOpencodeSpawnPlan("opencode.cmd", ["run", "--help"]);
    expect(mockSpawn).toHaveBeenCalledWith(plan.command, plan.args, {
      shell: plan.shell,
      stdio: ["inherit", "pipe", "pipe"],
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });
  });
});
