import { describe, it, expect, vi, beforeEach } from "vitest";

const runLoopMock = vi.fn<(opts: any) => Promise<boolean>>(() =>
  Promise.resolve(true),
);
const runListMock = vi.fn<(opts: any) => Promise<void>>(() =>
  Promise.resolve(),
);
const runInstallMock = vi.fn<(opts: any) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock("../src/orchestrator-loop.js", () => {
  return {
    runLoop: runLoopMock,
    enforceCommandPolicyGate: () => {},
    buildFileArgs: () => [],
  };
});

vi.mock("../src/orchestrator-list.js", () => {
  return {
    runList: runListMock,
  };
});

vi.mock("../src/orchestrator-install.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/orchestrator-install.js")>();
  return {
    ...actual,
    runInstall: runInstallMock,
  };
});

describe("runCli subcommands", () => {
  beforeEach(() => {
    runLoopMock.mockClear();
    runListMock.mockClear();
    runInstallMock.mockClear();
  });

  it("returns 0 when loop completes", async () => {
    runLoopMock.mockResolvedValueOnce(true);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["loop", "--task", "t", "do it"]);
    expect(code).toBe(0);
    expect(runLoopMock).toHaveBeenCalledTimes(1);
  });

  it("returns 1 when loop does not complete", async () => {
    runLoopMock.mockResolvedValueOnce(false);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["loop", "--task", "t", "do it"]);
    expect(code).toBe(1);
    expect(runLoopMock).toHaveBeenCalledTimes(1);
  });

  it("calls runList and returns 0", async () => {
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["list"]);
    expect(code).toBe(0);
    expect(runListMock).toHaveBeenCalledTimes(1);
  });

  it("calls runInstall and returns 0", async () => {
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["install", "--scope", "local"]);
    expect(code).toBe(0);
    expect(runInstallMock).toHaveBeenCalledTimes(1);
  });
});
