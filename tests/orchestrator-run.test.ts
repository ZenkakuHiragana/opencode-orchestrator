import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

declare const process: { env: Record<string, string | undefined> };

const runLoopMock = vi.fn<(opts: any) => Promise<boolean>>(() =>
  Promise.resolve(true),
);
const parseLoopArgsMock = vi.fn<(argv: string[]) => any>((argv) => ({ argv }));

vi.mock("../src/orchestrator-loop.js", () => {
  return {
    runLoop: runLoopMock,
  };
});

vi.mock("../src/cli-args.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cli-args.js")>();
  return {
    ...actual,
    parseLoopArgs: parseLoopArgsMock,
  };
});

describe("runRunCommand", () => {
  beforeEach(() => {
    runLoopMock.mockClear();
    parseLoopArgsMock.mockClear();
  });

  it("preserves supported loop flags when starting a ready task", async () => {
    const { runRunCommand } = await import("../src/orchestrator-run.js");

    const originalXdg = process.env.XDG_STATE_HOME;
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-run-test-"));
    process.env.XDG_STATE_HOME = tmpBase;

    try {
      const task = "demo-task";
      const stateDir = path.join(
        tmpBase,
        "opencode",
        "orchestrator",
        task,
        "state",
      );
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, "command-policy.json"),
        JSON.stringify(
          {
            version: 1,
            summary: {
              loop_status: "ready_for_loop",
            },
            commands: [],
          },
          null,
          2,
        ),
        "utf8",
      );

      parseLoopArgsMock.mockImplementationOnce((argv: string[]) => ({ argv }));
      runLoopMock.mockResolvedValueOnce(true);

      const code = await runRunCommand({
        argv: ["--task", task, "--max-loop", "6", "--commit"],
      });

      expect(code).toBe(0);
      expect(parseLoopArgsMock).toHaveBeenCalledWith([
        "--task",
        task,
        "--max-loop",
        "6",
        "--commit",
      ]);
      expect(runLoopMock).toHaveBeenCalledWith({
        argv: ["--task", task, "--max-loop", "6", "--commit"],
      });
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = originalXdg;
      }
    }
  });

  it("rejects unsupported low-level session options instead of ignoring them", async () => {
    const { runRunCommand } = await import("../src/orchestrator-run.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runRunCommand({ argv: ["--session", "ses-1"] });

    expect(code).toBe(1);
    expect(parseLoopArgsMock).not.toHaveBeenCalled();
    expect(runLoopMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it("returns 1 when the underlying loop declines to continue", async () => {
    const { runRunCommand } = await import("../src/orchestrator-run.js");

    const originalXdg = process.env.XDG_STATE_HOME;
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-run-test-"));
    process.env.XDG_STATE_HOME = tmpBase;

    try {
      const task = "demo-task";
      const stateDir = path.join(
        tmpBase,
        "opencode",
        "orchestrator",
        task,
        "state",
      );
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(stateDir, "command-policy.json"),
        JSON.stringify(
          {
            version: 1,
            summary: {
              loop_status: "ready_for_loop",
            },
            commands: [],
          },
          null,
          2,
        ),
        "utf8",
      );

      parseLoopArgsMock.mockImplementationOnce((argv: string[]) => ({ argv }));
      runLoopMock.mockResolvedValueOnce(false);

      const code = await runRunCommand({ argv: ["--task", task] });

      expect(code).toBe(1);
      expect(runLoopMock).toHaveBeenCalledTimes(1);
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = originalXdg;
      }
    }
  });
});
