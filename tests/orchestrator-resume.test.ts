import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// NOTE: These tests assume a Node-like runtime where `process.env` exists.
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

describe("runResumeCommand", () => {
  beforeEach(() => {
    runLoopMock.mockClear();
    parseLoopArgsMock.mockClear();
  });

  it("returns 1 and prints guidance when --task is missing", async () => {
    const { runResumeCommand } = await import("../src/orchestrator-resume.js");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const code = await runResumeCommand({ argv: [] });

    expect(code).toBe(1);
    expect(parseLoopArgsMock).not.toHaveBeenCalled();
    expect(runLoopMock).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it("parses --task and calls runLoop with --continue", async () => {
    const { runResumeCommand } = await import("../src/orchestrator-resume.js");

    const originalXdg = process.env.XDG_STATE_HOME;
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "orch-resume-test-"));
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

      const code = await runResumeCommand({ argv: ["--task", task] });

      expect(code).toBe(0);
      expect(parseLoopArgsMock).toHaveBeenCalledTimes(1);
      expect(parseLoopArgsMock).toHaveBeenCalledWith([
        "--task",
        task,
        "--continue",
      ]);
      expect(runLoopMock).toHaveBeenCalledTimes(1);
      expect(runLoopMock).toHaveBeenCalledWith({
        argv: ["--task", task, "--continue"],
      });
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = originalXdg;
      }
    }
  });
});
