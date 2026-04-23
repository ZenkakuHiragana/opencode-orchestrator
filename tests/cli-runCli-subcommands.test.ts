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
const runClearMock = vi.fn<(opts: any) => Promise<void>>(() =>
  Promise.resolve(),
);
const runExecMock = vi.fn<(opts: any) => Promise<any>>(() =>
  Promise.resolve({ code: 0, stdout: "", stderr: "", truncated: false }),
);

const runRunCommandMock = vi.fn<(opts: any) => Promise<number>>(() =>
  Promise.resolve(0),
);
const runResumeCommandMock = vi.fn<(opts: any) => Promise<number>>(() =>
  Promise.resolve(0),
);
const runStatusCommandMock = vi.fn<(opts: any) => Promise<number>>(() =>
  Promise.resolve(0),
);
const runDoctorCommandMock = vi.fn<(opts: any) => Promise<number>>(() =>
  Promise.resolve(0),
);
const runFixCommandMock = vi.fn<(opts: any) => Promise<number>>(() =>
  Promise.resolve(0),
);
const runCompletionCommandMock = vi.fn<(opts: any) => Promise<number>>(() =>
  Promise.resolve(0),
);
const runCompleteCommandMock = vi.fn<(opts: any) => Promise<number>>(() =>
  Promise.resolve(0),
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

vi.mock("../src/orchestrator-clear.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/orchestrator-clear.js")>();
  return {
    ...actual,
    runClear: runClearMock,
  };
});

vi.mock("../src/exec-runner.js", () => {
  return {
    runExec: runExecMock,
  };
});

vi.mock("../src/orchestrator-run.js", () => {
  return {
    runRunCommand: runRunCommandMock,
  };
});

vi.mock("../src/orchestrator-resume.js", () => {
  return {
    runResumeCommand: runResumeCommandMock,
  };
});

vi.mock("../src/orchestrator-status.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/orchestrator-status.js")>();
  return {
    ...actual,
    runStatusCommand: runStatusCommandMock,
  };
});

vi.mock("../src/orchestrator-doctor.js", () => {
  return {
    runDoctorCommand: runDoctorCommandMock,
  };
});

vi.mock("../src/orchestrator-fix.js", () => {
  return {
    runFixCommand: runFixCommandMock,
  };
});

vi.mock("../src/orchestrator-completion.js", () => {
  return {
    runCompletionCommand: runCompletionCommandMock,
    runCompleteCommand: runCompleteCommandMock,
  };
});

describe("runCli subcommands", () => {
  beforeEach(() => {
    runLoopMock.mockClear();
    runListMock.mockClear();
    runInstallMock.mockClear();
    runClearMock.mockClear();
    runExecMock.mockClear();
    runRunCommandMock.mockClear();
    runResumeCommandMock.mockClear();
    runStatusCommandMock.mockClear();
    runDoctorCommandMock.mockClear();
    runFixCommandMock.mockClear();
    runCompletionCommandMock.mockClear();
    runCompleteCommandMock.mockClear();
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

  it("calls runExec and returns 0", async () => {
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["exec", "--file", "helper.mjs"]);
    expect(code).toBe(0);
    expect(runExecMock).toHaveBeenCalledTimes(1);
  });

  it("calls runRunCommand and returns its exit code", async () => {
    runRunCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["run", "--task", "t1"]);
    expect(code).toBe(0);
    expect(runRunCommandMock).toHaveBeenCalledTimes(1);
    expect(runRunCommandMock).toHaveBeenCalledWith({ argv: ["--task", "t1"] });
  });

  it("rewrites -t to --task for task-accepting subcommands", async () => {
    runRunCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");

    const code = await runCli(["run", "-t", "t1"]);

    expect(code).toBe(0);
    expect(runRunCommandMock).toHaveBeenCalledTimes(1);
    expect(runRunCommandMock).toHaveBeenCalledWith({ argv: ["--task", "t1"] });
  });

  it("rejects when both --task and -t are provided", async () => {
    const { runCli } = await import("../src/cli.js");

    const code = await runCli(["run", "--task", "t1", "-t", "t2"]);

    expect(code).toBe(1);
    expect(runRunCommandMock).not.toHaveBeenCalled();
  });

  it("rewrites -t to --task for resume/status/doctor/fix/list", async () => {
    runResumeCommandMock.mockResolvedValueOnce(0);
    runStatusCommandMock.mockResolvedValueOnce(0);
    runDoctorCommandMock.mockResolvedValueOnce(0);
    runFixCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");

    let code = await runCli(["resume", "-t", "t1"]);
    expect(code).toBe(0);
    expect(runResumeCommandMock).toHaveBeenCalledTimes(1);
    expect(runResumeCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t1"],
    });

    code = await runCli(["status", "-t", "t2"]);
    expect(code).toBe(0);
    expect(runStatusCommandMock).toHaveBeenCalledTimes(1);
    expect(runStatusCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t2"],
    });

    code = await runCli(["doctor", "-t", "t3"]);
    expect(code).toBe(0);
    expect(runDoctorCommandMock).toHaveBeenCalledTimes(1);
    expect(runDoctorCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t3"],
    });

    code = await runCli(["fix", "-t", "t4"]);
    expect(code).toBe(0);
    expect(runFixCommandMock).toHaveBeenCalledTimes(1);
    expect(runFixCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t4"],
    });

    runListMock.mockClear();
    const listCode = await runCli(["list", "-t", "t5", "--proposals"]);
    expect(listCode).toBe(0);
    expect(runListMock).toHaveBeenCalledTimes(1);
  });

  it("rewrites -t to --task for clear before parsing", async () => {
    const { runCli } = await import("../src/cli.js");

    const code = await runCli(["clear", "-t", "t1", "--proposals", "-y"]);

    expect(code).toBe(0);
    expect(runClearMock).toHaveBeenCalledTimes(1);
    expect(runClearMock).toHaveBeenCalledWith({
      task: "t1",
      clearProposals: true,
      yes: true,
      resolveId: undefined,
      dismissId: undefined,
    });
  });

  it("rewrites -t to --task for loop before parsing", async () => {
    runLoopMock.mockResolvedValueOnce(true);
    const { runCli } = await import("../src/cli.js");

    const code = await runCli(["loop", "-t", "t1", "do it"]);

    expect(code).toBe(0);
    expect(runLoopMock).toHaveBeenCalledTimes(1);
    const call = runLoopMock.mock.calls[0] as unknown[];
    const opts = call[0] as { task: string };
    expect(opts.task).toBe("t1");
  });

  it("rejects when both --task and -t are provided for other task-accepting subcommands", async () => {
    const { runCli } = await import("../src/cli.js");

    let code = await runCli(["resume", "--task", "t1", "-t", "t2"]);
    expect(code).toBe(1);
    expect(runResumeCommandMock).not.toHaveBeenCalled();

    code = await runCli(["status", "--task", "t1", "-t", "t2"]);
    expect(code).toBe(1);
    expect(runStatusCommandMock).not.toHaveBeenCalled();

    code = await runCli(["doctor", "--task", "t1", "-t", "t2"]);
    expect(code).toBe(1);
    expect(runDoctorCommandMock).not.toHaveBeenCalled();

    code = await runCli(["fix", "--task", "t1", "-t", "t2"]);
    expect(code).toBe(1);
    expect(runFixCommandMock).not.toHaveBeenCalled();

    code = await runCli(["list", "--task", "t1", "-t", "t2", "--proposals"]);
    expect(code).toBe(1);
    expect(runListMock).not.toHaveBeenCalled();
  });

  it("calls runResumeCommand and returns its exit code", async () => {
    runResumeCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["resume", "--task", "t1"]);
    expect(code).toBe(0);
    expect(runResumeCommandMock).toHaveBeenCalledTimes(1);
    expect(runResumeCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t1"],
    });
  });

  it("calls runStatusCommand and returns its exit code", async () => {
    runStatusCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["status", "--task", "t1"]);
    expect(code).toBe(0);
    expect(runStatusCommandMock).toHaveBeenCalledTimes(1);
    expect(runStatusCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t1"],
    });
  });

  it("calls runDoctorCommand and returns its exit code", async () => {
    runDoctorCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["doctor", "--task", "t1"]);
    expect(code).toBe(0);
    expect(runDoctorCommandMock).toHaveBeenCalledTimes(1);
    expect(runDoctorCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t1"],
    });
  });

  it("calls runFixCommand and returns its exit code", async () => {
    runFixCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["fix", "--task", "t1"]);
    expect(code).toBe(0);
    expect(runFixCommandMock).toHaveBeenCalledTimes(1);
    expect(runFixCommandMock).toHaveBeenCalledWith({
      argv: ["--task", "t1"],
    });
  });

  it("calls runCompletionCommand and returns its exit code", async () => {
    runCompletionCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["completion", "bash"]);
    expect(code).toBe(0);
    expect(runCompletionCommandMock).toHaveBeenCalledTimes(1);
    expect(runCompletionCommandMock).toHaveBeenCalledWith({
      argv: ["bash"],
    });
  });

  it("calls runCompleteCommand for __complete and returns its exit code", async () => {
    runCompleteCommandMock.mockResolvedValueOnce(0);
    const { runCli } = await import("../src/cli.js");
    const code = await runCli(["__complete", "bash", "ococ", "1"]);
    expect(code).toBe(0);
    expect(runCompleteCommandMock).toHaveBeenCalledTimes(1);
    expect(runCompleteCommandMock).toHaveBeenCalledWith({
      argv: ["bash", "ococ", "1"],
    });
  });
});
