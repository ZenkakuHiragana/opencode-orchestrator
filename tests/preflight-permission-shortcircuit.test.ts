import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import preflightCliTool, {
  evaluateBashPermission,
  evaluateEffectiveBashPermission,
} from "../src/preflight-cli.js";
import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";
import { setPreflightRunnerBashPermissionSource } from "../src/preflight-permission-store.js";

function prepareState(task: string, withCommand = false): void {
  const stateDir = getOrchestratorStateDir(task);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "acceptance-index.json"), "{}", "utf8");
  fs.writeFileSync(path.join(stateDir, "spec.md"), "# spec\n", "utf8");
  const basePolicy = {
    version: 1 as const,
    summary: {
      loop_status: "ready_for_loop" as const,
      helper_availability: {
        "helper:grep": "available",
        "helper:rg": "available",
        "helper:sort": "available",
        "helper:sort-with-flags": "available",
        "helper:uniq": "available",
        "helper:uniq-with-flags": "available",
        "helper:wc": "available",
        "helper:head": "available",
        "helper:tail": "available",
        "helper:cut": "available",
        "helper:tr": "available",
        "helper:comm": "available",
        "helper:cat": "available",
        "helper:ls": "available",
        "helper:jq": "available",
        "helper:true": "available",
        "helper:false": "available",
        "helper:test": "available",
        "helper:bracket": "available",
      },
    },
    commands: [] as any[],
  };

  if (withCommand) {
    basePolicy.commands.push({
      id: "cmd-ls",
      command: "ls -l",
      role: "test",
      usage: "must_exec",
      availability: "available",
      related_requirements: [],
      probe_command: "ls --help",
      parameters: {},
      usage_notes: "",
    });
  }

  fs.writeFileSync(
    path.join(stateDir, "command-policy.json"),
    JSON.stringify(basePolicy),
    "utf8",
  );
}

describe("preflight permission evaluation", () => {
  it("uses ask fallback when object rules do not match", () => {
    expect(
      evaluateBashPermission("ls -l", {
        "git *": "deny",
      }),
    ).toEqual({
      decision: "ask",
      determined: true,
      matchedPattern: null,
    });
  });

  it("defaults to allow only when global/agent are both undefined", () => {
    expect(
      evaluateEffectiveBashPermission("ls -l", {
        globalBash: undefined,
        agentBash: undefined,
      }),
    ).toEqual({
      decision: "allow",
      determined: true,
      matchedPattern: null,
    });
  });

  it("uses global match when agent layer has no match", () => {
    expect(
      evaluateEffectiveBashPermission("ls -l", {
        globalBash: {
          "*": "allow",
        },
        agentBash: {
          "git *": "deny",
        },
      }),
    ).toEqual({
      decision: "allow",
      determined: true,
      matchedPattern: "*",
    });
  });
});

describe("preflight-cli short-circuit with effective permission", () => {
  it("short-circuits to allow when both permission sources are missing", async () => {
    const prevXdg = process.env.XDG_STATE_HOME;
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-short-all-"));
    process.env.XDG_STATE_HOME = xdg;

    try {
      const task = "short-circuit-all-allow";
      prepareState(task);
      setPreflightRunnerBashPermissionSource({
        globalBash: undefined,
        agentBash: undefined,
      });

      const raw = await preflightCliTool.execute(
        {
          task,
          commands: [
            {
              id: "cmd-missing",
              command: "__definitely_missing_command__ --version",
              role: "test",
              usage: "must_exec",
            },
          ],
        },
        { agent: "orch-planner", worktree: process.cwd() } as any,
      );

      const parsed = JSON.parse(raw) as {
        status: "ok" | "failed";
        results: {
          id: string;
          available: boolean;
          stderr_excerpt: string;
        }[];
      };

      expect(parsed.status).toBe("ok");
      const cmd = parsed.results.find((r) => r.id === "cmd-missing");
      expect(cmd).toBeTruthy();
      expect(cmd!.available).toBe(true);
      expect(cmd!.stderr_excerpt).toContain(
        "short-circuit: permission.bash=allow",
      );

      // Command-policy should be updated by preflight-cli: helper_availability
      // should reflect the short-circuit result and loop_status should remain
      // ready_for_loop because must_exec command is allowed.
      const stateDir = getOrchestratorStateDir(task);
      const policyPath = path.join(stateDir, "command-policy.json");
      const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as {
        summary: {
          loop_status: string;
          helper_availability: Record<string, string>;
        };
        commands: { id: string; availability: string }[];
      };

      expect(policy.summary.loop_status).toBe("ready_for_loop");
      expect(policy.summary.helper_availability["helper:grep"]).toBe(
        "available",
      );
      const cmdPolicy = policy.commands.find((c) => c.id === "cmd-missing");
      // commands[] was initially empty, so we do not expect an entry here yet.
      expect(cmdPolicy).toBeUndefined();
    } finally {
      setPreflightRunnerBashPermissionSource({
        globalBash: undefined,
        agentBash: undefined,
      });
      process.env.XDG_STATE_HOME = prevXdg;
    }
  });

  it("short-circuits to ask when agent object has no matching rule", async () => {
    const prevXdg = process.env.XDG_STATE_HOME;
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-short-ask-"));
    process.env.XDG_STATE_HOME = xdg;

    try {
      const task = "short-circuit-object-fallback-ask";
      // Prepare state with a must_exec command so that preflight-cli can
      // update its availability and loop_status becomes blocked.
      prepareState(task, true);
      setPreflightRunnerBashPermissionSource({
        globalBash: undefined,
        agentBash: {
          "git *": "deny",
        },
      });

      const raw = await preflightCliTool.execute(
        {
          task,
          commands: [
            {
              id: "cmd-ls",
              command: "ls -l",
              role: "test",
              usage: "must_exec",
            },
          ],
        },
        { agent: "orch-planner", worktree: process.cwd() } as any,
      );

      const parsed = JSON.parse(raw) as {
        status: "ok" | "failed";
        results: {
          id: string;
          available: boolean;
          stderr_excerpt: string;
        }[];
      };

      expect(parsed.status).toBe("failed");
      const cmd = parsed.results.find((r) => r.id === "cmd-ls");
      expect(cmd).toBeTruthy();
      expect(cmd!.available).toBe(false);
      expect(cmd!.stderr_excerpt).toContain(
        "short-circuit: permission.bash=ask",
      );

      // For a must_exec command that is unavailable due to permission=ask,
      // loop_status should be downgraded by preflight-cli to
      // blocked_by_environment (since this is an environment/permission issue,
      // not a SPEC_ERROR).
      const stateDir = getOrchestratorStateDir(task);
      const policyPath = path.join(stateDir, "command-policy.json");
      const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as {
        summary: { loop_status: string };
        commands: { id: string; availability: string }[];
      };

      expect(policy.summary.loop_status).toBe("blocked_by_environment");
    } finally {
      setPreflightRunnerBashPermissionSource({
        globalBash: undefined,
        agentBash: undefined,
      });
      process.env.XDG_STATE_HOME = prevXdg;
    }
  });
});
