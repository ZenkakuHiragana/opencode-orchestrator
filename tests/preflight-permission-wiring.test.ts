/**
 * Regression tests for the plugin config → permission store → preflight wiring.
 *
 * These tests verify that the production code path actually populates the
 * preflight permission store from real config values.  Before this wiring was
 * added, setPreflightRunnerBashPermissionSource was never called in production,
 * so preflight always fell through to the "both undefined → allow" path —
 * even when the user had configured restrictive bash permissions.
 *
 * See: "preflight が壊れている" — bin/Debug/myprogram.exe passed preflight
 * despite user-configured restrictions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { OrchestratorPlugin } from "../src/index.js";
import { getPreflightRunnerBashPermissionSource } from "../src/preflight-permission-store.js";
import preflightCliTool from "../src/preflight-cli.js";
import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";

/**
 * Prepare the minimum orchestrator state files that preflight-cli requires
 * before it will run any checks.
 */
function preparePreflightState(task: string): void {
  const stateDir = getOrchestratorStateDir(task);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "acceptance-index.json"), "{}", "utf8");
  fs.writeFileSync(path.join(stateDir, "spec.md"), "# spec\n", "utf8");
  fs.writeFileSync(
    path.join(stateDir, "command-policy.json"),
    JSON.stringify({
      version: 1,
      summary: { loop_status: "needs_refinement" },
      commands: [],
    }),
    "utf8",
  );
}

describe("plugin config hook wires preflight permission store", () => {
  it("populates globalBash from config.permission.bash", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      permission: {
        bash: {
          "*": "ask",
          "npm *": "allow",
        },
      },
    };
    await plugin.config!(config);

    const store = getPreflightRunnerBashPermissionSource();
    expect(store.globalBash).toEqual({
      "*": "ask",
      "npm *": "allow",
    });
  });

  it("populates agentBash from the merged executor agent permission.bash", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      agent: {
        "orch-executor": {
          permission: {
            bash: {
              "*": "deny",
              "git status": "allow",
            },
          },
        },
      },
    };
    await plugin.config!(config);

    const store = getPreflightRunnerBashPermissionSource();
    expect(store.agentBash).toEqual({
      "*": "deny",
      "git status": "allow",
    });
  });

  it("leaves both fields undefined when no bash permissions are configured", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const store = getPreflightRunnerBashPermissionSource();
    expect(store.globalBash).toBeUndefined();
    expect(store.agentBash).toBeUndefined();
  });
});

describe("plugin config → preflight end-to-end", () => {
  let prevXdg: string | undefined;

  beforeEach(() => {
    prevXdg = process.env.XDG_STATE_HOME;
  });

  afterEach(() => {
    if (prevXdg === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = prevXdg;
    }
  });

  it("blocks a command not allowed by user-configured global bash permission", async () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-wiring-e2e-"));
    process.env.XDG_STATE_HOME = xdg;

    const task = "wiring-e2e-blocked";
    preparePreflightState(task);

    // Simulate user configuring restrictive bash permissions:
    // only npm commands are allowed, everything else is "ask".
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      permission: {
        bash: {
          "*": "ask",
          "npm *": "allow",
        },
      },
    };
    await plugin.config!(config);

    // Now run preflight for a command that should NOT be allowed.
    const raw = await preflightCliTool.execute(
      {
        task,
        commands: [
          {
            id: "cmd-exe",
            command: "bin/Debug/myprogram.exe",
            role: "build-and-run",
            usage: "must_exec",
          },
        ],
      },
      { agent: "orch-planner", worktree: process.cwd() } as any,
    );

    const res = JSON.parse(raw) as {
      status: "ok" | "failed";
      results: { id: string; available: boolean; stderr_excerpt: string }[];
    };

    expect(res.status).toBe("failed");
    const cmd = res.results.find((r) => r.id === "cmd-exe");
    expect(cmd).toBeTruthy();
    expect(cmd!.available).toBe(false);
    expect(cmd!.stderr_excerpt).toContain("short-circuit: permission.bash=ask");
  });

  it("allows a command matched by user-configured global bash permission", async () => {
    const xdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-wiring-e2e-allow-"),
    );
    process.env.XDG_STATE_HOME = xdg;

    const task = "wiring-e2e-allowed";
    preparePreflightState(task);

    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      permission: {
        bash: {
          "*": "ask",
          "npm *": "allow",
        },
      },
    };
    await plugin.config!(config);

    const raw = await preflightCliTool.execute(
      {
        task,
        commands: [
          {
            id: "cmd-npm",
            command: "npm test",
            role: "test",
            usage: "must_exec",
          },
        ],
      },
      { agent: "orch-planner", worktree: process.cwd() } as any,
    );

    const res = JSON.parse(raw) as {
      status: "ok" | "failed";
      results: { id: string; available: boolean; stderr_excerpt: string }[];
    };

    expect(res.status).toBe("ok");
    const cmd = res.results.find((r) => r.id === "cmd-npm");
    expect(cmd).toBeTruthy();
    expect(cmd!.available).toBe(true);
    expect(cmd!.stderr_excerpt).toContain(
      "short-circuit: permission.bash=allow",
    );
  });

  it("allows all commands when no bash permissions are configured (OpenCode default)", async () => {
    const xdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-wiring-e2e-default-"),
    );
    process.env.XDG_STATE_HOME = xdg;

    const task = "wiring-e2e-default";
    preparePreflightState(task);

    // No permission.bash configured at all.
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const raw = await preflightCliTool.execute(
      {
        task,
        commands: [
          {
            id: "cmd-arbitrary",
            command: "some-random-command --flag",
            role: "test",
            usage: "must_exec",
          },
        ],
      },
      { agent: "orch-planner", worktree: process.cwd() } as any,
    );

    const res = JSON.parse(raw) as {
      status: "ok" | "failed";
      results: { id: string; available: boolean; stderr_excerpt: string }[];
    };

    // OpenCode's permissive default: allow everything.
    expect(res.status).toBe("ok");
    const cmd = res.results.find((r) => r.id === "cmd-arbitrary");
    expect(cmd).toBeTruthy();
    expect(cmd!.available).toBe(true);
  });

  it("agent-level bash permission overrides global for the executor", async () => {
    const xdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-wiring-e2e-agent-override-"),
    );
    process.env.XDG_STATE_HOME = xdg;

    const task = "wiring-e2e-agent-override";
    preparePreflightState(task);

    // Global: deny everything. Agent override: allow git status.
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      permission: {
        bash: {
          "*": "deny",
        },
      },
      agent: {
        "orch-executor": {
          permission: {
            bash: {
              "*": "ask",
              "git *": "allow",
            },
          },
        },
      },
    };
    await plugin.config!(config);

    const raw = await preflightCliTool.execute(
      {
        task,
        commands: [
          {
            id: "cmd-git",
            command: "git status",
            role: "inspect",
            usage: "must_exec",
          },
          {
            id: "cmd-rm",
            command: "rm -rf /tmp/test",
            role: "cleanup",
            usage: "may_exec",
          },
        ],
      },
      { agent: "orch-planner", worktree: process.cwd() } as any,
    );

    const res = JSON.parse(raw) as {
      status: "ok" | "failed";
      results: { id: string; available: boolean; stderr_excerpt: string }[];
    };

    // git status: allowed via agent override
    const gitCmd = res.results.find((r) => r.id === "cmd-git");
    expect(gitCmd).toBeTruthy();
    expect(gitCmd!.available).toBe(true);

    // rm -rf: falls to agent "*" → ask → unavailable
    const rmCmd = res.results.find((r) => r.id === "cmd-rm");
    expect(rmCmd).toBeTruthy();
    expect(rmCmd!.available).toBe(false);
  });
});
