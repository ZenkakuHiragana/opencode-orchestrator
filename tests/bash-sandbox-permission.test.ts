import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { OrchestratorPlugin } from "../src/index.js";
import { setPreflightRunnerBashPermissionSource } from "../src/preflight-permission-store.js";

describe("bash sandbox pre-hook permission behavior", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("blocks commands when permission.bash decision is deny", async () => {
    const client = {};
    const plugin = await OrchestratorPlugin({ client } as any);

    // permission.bash: deny any command matching "git reset --hard*"
    setPreflightRunnerBashPermissionSource({
      globalBash: {
        "git reset --hard*": "deny",
      },
      agentBash: undefined,
    });

    process.env.OPENCODE_ORCH_EXEC_BWRAP_ARGS = JSON.stringify([
      "--unshare-pid",
    ]);

    const hook = (plugin as any)["tool.execute.before"] as
      | ((input: any, output: any) => Promise<void>)
      | undefined;
    expect(typeof hook).toBe("function");

    const args = { command: "git reset --hard" };

    await expect(
      hook!({ tool: "bash", sessionID: "s", callID: "c" }, { args }),
    ).rejects.toThrow(/decision: deny/);
  });

  it("blocks commands when permission.bash decision is ask", async () => {
    const client = {};
    const plugin = await OrchestratorPlugin({ client } as any);

    // permission.bash: ask for any command matching "rm *"
    setPreflightRunnerBashPermissionSource({
      globalBash: {
        "rm *": "ask",
      },
      agentBash: undefined,
    });

    process.env.OPENCODE_ORCH_EXEC_BWRAP_ARGS = JSON.stringify([
      "--unshare-pid",
    ]);

    const hook = (plugin as any)["tool.execute.before"] as
      | ((input: any, output: any) => Promise<void>)
      | undefined;
    expect(typeof hook).toBe("function");

    const args = { command: "rm important.txt" };

    await expect(
      hook!({ tool: "bash", sessionID: "s", callID: "c" }, { args }),
    ).rejects.toThrow(/decision: ask/);
  });

  it("wraps allowed commands with bwrap when args are present", async () => {
    const client = {};
    const plugin = await OrchestratorPlugin({ client } as any);

    // permission.bash: allow everything by default
    setPreflightRunnerBashPermissionSource({
      globalBash: undefined,
      agentBash: undefined,
    });

    process.env.OPENCODE_ORCH_EXEC_BWRAP_ARGS = JSON.stringify([
      "--unshare-pid",
      "--unshare-net",
    ]);

    const hook = (plugin as any)["tool.execute.before"] as
      | ((input: any, output: any) => Promise<void>)
      | undefined;
    expect(typeof hook).toBe("function");

    const args: { command: string } = { command: "ls -la" };

    await hook!({ tool: "bash", sessionID: "s", callID: "c" }, { args });

    expect(args.command).toMatch(/^'bwrap' '\-\-unshare-pid'/);
    expect(args.command).toContain("-- bash -lc '");
    expect(args.command).toMatch(/ls -la'$/);
  });
});
