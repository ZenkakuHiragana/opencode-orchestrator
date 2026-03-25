import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  evaluateBashPermission,
  interpretPreflightRun,
  type CommandDescriptor,
  type OpencodeRunResult,
} from "../src/preflight-cli.js";
import preflightCliTool from "../src/preflight-cli.js";
import { buildOpencodeSpawnPlan } from "../src/opencode-spawn.js";
import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";
import { setPreflightRunnerBashPermissionSource } from "../src/preflight-permission-store.js";

describe("buildOpencodeSpawnPlan", () => {
  it("uses node script directly on Windows when opencode script path is known", () => {
    const scriptPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "opencode-preflight-")),
      "opencode",
    );
    fs.writeFileSync(scriptPath, "#!/usr/bin/env node\n", "utf8");

    const plan = buildOpencodeSpawnPlan(
      scriptPath,
      [
        "run",
        "--format",
        "json",
        "--command",
        "orch-preflight",
        "--title",
        "test --help:mn1rbwla:7w4czfjf",
        "--dir",
        "D:\\repo",
        '[{"id":"cmd-npm-test","command":"npm test -- --help"}]',
      ],
      "win32",
    );

    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toEqual([
      scriptPath,
      "run",
      "--format",
      "json",
      "--command",
      "orch-preflight",
      "--title",
      "test --help:mn1rbwla:7w4czfjf",
      "--dir",
      "D:\\repo",
      '[{"id":"cmd-npm-test","command":"npm test -- --help"}]',
    ]);
    expect(plan.shell).toBe(false);
    expect(plan.windowsVerbatimArguments).toBeUndefined();
  });

  it("falls back to cmd.exe wrapping on Windows when script path is unknown", () => {
    const plan = buildOpencodeSpawnPlan(
      "C:\\missing\\opencode.cmd",
      ["run", "--help"],
      "win32",
      "C:\\Windows\\System32\\cmd.exe",
    );

    expect(plan).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "C:\\missing\\opencode.cmd", "run", "--help"],
      shell: false,
      windowsVerbatimArguments: true,
    });
  });

  it("avoids shell mode on non-Windows platforms", () => {
    const plan = buildOpencodeSpawnPlan("opencode", ["run", "--help"], "linux");

    expect(plan).toEqual({
      command: "opencode",
      args: ["run", "--help"],
      shell: false,
    });
  });
});

describe("interpretPreflightRun", () => {
  const descriptor: CommandDescriptor = {
    id: "cmd_npm_test",
    command: "npm test",
    role: "tests",
    usage: "must_exec",
  };

  it("treats opencode failure with no stdout as unavailable", () => {
    const runResult: OpencodeRunResult = {
      stdout: "",
      stderr: "some error",
      code: 1,
    };

    const { result, sessionID } = interpretPreflightRun(descriptor, runResult);
    expect(sessionID).toBeNull();
    expect(result.available).toBe(false);
    expect(result.exit_code).toBe(1);
    expect(result.command).toBe("npm test");
    expect(result.role).toBe("tests");
    expect(result.usage).toBe("must_exec");
    expect(result.stderr_excerpt).toContain("some error");
  });

  it("extracts JSON results when present", () => {
    const payload = {
      status: "ok",
      results: [
        {
          command: "npm test",
          role: "tests",
          usage: "must_exec" as const,
          available: true,
          exit_code: 0,
          stderr_excerpt: "",
        },
      ],
    };

    const eventLine = JSON.stringify({
      type: "text",
      part: { text: JSON.stringify(payload) },
      sessionID: "ses_123",
    });

    const runResult: OpencodeRunResult = {
      stdout: eventLine + "\n",
      stderr: "",
      code: 0,
    };

    const { result, sessionID } = interpretPreflightRun(descriptor, runResult);
    expect(sessionID).toBe("ses_123");
    expect(result.command).toBe("npm test");
    expect(result.role).toBe("tests");
    expect(result.usage).toBe("must_exec");
    expect(result.available).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.stderr_excerpt).toBe("");
  });

  it("extracts JSON when wrapped in markdown code fences", () => {
    const payload = {
      status: "ok",
      results: [
        {
          command: "npm test",
          role: "tests",
          usage: "must_exec" as const,
          available: true,
          exit_code: 0,
          stderr_excerpt: "",
        },
      ],
    };

    // Simulate LLM wrapping JSON in ```json ... ``` fences
    const fencedText = "```json\n" + JSON.stringify(payload) + "\n```";

    const eventLine = JSON.stringify({
      type: "text",
      part: { text: fencedText },
      sessionID: "ses_456",
    });

    const runResult: OpencodeRunResult = {
      stdout: eventLine + "\n",
      stderr: "",
      code: 0,
    };

    const { result, sessionID } = interpretPreflightRun(descriptor, runResult);
    expect(sessionID).toBe("ses_456");
    expect(result.available).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.stderr_excerpt).toBe("");
  });

  it("extracts JSON when wrapped in plain markdown code fences", () => {
    const payload = {
      status: "ok",
      results: [
        {
          command: "npm test",
          role: "tests",
          usage: "must_exec" as const,
          available: true,
          exit_code: 0,
          stderr_excerpt: "",
        },
      ],
    };

    // Simulate LLM wrapping JSON in ``` ... ``` fences (no language tag)
    const fencedText = "```\n" + JSON.stringify(payload) + "\n```";

    const eventLine = JSON.stringify({
      type: "text",
      part: { text: fencedText },
    });

    const runResult: OpencodeRunResult = {
      stdout: eventLine + "\n",
      stderr: "",
      code: 0,
    };

    const { result } = interpretPreflightRun(descriptor, runResult);
    expect(result.available).toBe(true);
    expect(result.exit_code).toBe(0);
  });

  it("falls back to tool_use error details when JSON is missing", () => {
    const lines = [
      JSON.stringify({
        type: "tool_use",
        part: {
          tool: "bash",
          state: {
            status: "error",
            input: { command: "npm test" },
            error: "permission denied",
          },
        },
      }),
    ].join("\n");

    const runResult: OpencodeRunResult = {
      stdout: lines + "\n",
      stderr: "",
      code: 0,
    };

    const { result, sessionID } = interpretPreflightRun(descriptor, runResult);
    expect(sessionID).toBeNull();
    expect(result.available).toBe(false);
    expect(result.stderr_excerpt).toContain(
      'preflight probe "npm test" failed',
    );
    expect(result.stderr_excerpt).toContain("permission denied");
  });
});

describe("evaluateBashPermission", () => {
  it("defaults to ask when permission.bash is missing", () => {
    expect(evaluateBashPermission("ls -l", undefined)).toEqual({
      decision: "ask",
      determined: true,
      matchedPattern: null,
    });
  });

  it("uses last-match-wins for wildcard rules", () => {
    const rules = {
      "*": "ask",
      "ls *": "allow",
      "ls -l": "deny",
    };

    expect(evaluateBashPermission("ls -l", rules)).toEqual({
      decision: "deny",
      determined: true,
      matchedPattern: "ls -l",
    });
    expect(evaluateBashPermission("ls -a", rules)).toEqual({
      decision: "allow",
      determined: true,
      matchedPattern: "ls *",
    });
    expect(evaluateBashPermission("pwd", rules)).toEqual({
      decision: "ask",
      determined: true,
      matchedPattern: "*",
    });
  });

  it("treats non-object and invalid values as ask", () => {
    expect(evaluateBashPermission("ls", 123)).toEqual({
      decision: "ask",
      determined: true,
      matchedPattern: null,
    });

    expect(
      evaluateBashPermission("ls", {
        "*": "ASK",
      }),
    ).toEqual({
      decision: "ask",
      determined: true,
      matchedPattern: null,
    });
  });
});

describe("preflight-cli permission short-circuit", () => {
  function prepareState(task: string): void {
    const stateDir = getOrchestratorStateDir(task);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "acceptance-index.json"),
      "{}",
      "utf8",
    );
    fs.writeFileSync(path.join(stateDir, "spec.md"), "# spec\n", "utf8");
    fs.writeFileSync(path.join(stateDir, "command-policy.json"), "{}", "utf8");
  }

  it("short-circuits all probes as allow when permission.bash is undefined", async () => {
    const prevXdg = process.env.XDG_STATE_HOME;
    const xdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "preflight-short-allow-"),
    );
    process.env.XDG_STATE_HOME = xdg;

    try {
      const task = "short-circuit-allow";
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
              id: "cmd-missing-bin",
              command: "__definitely_missing_command__ --version",
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
      const target = res.results.find((r) => r.id === "cmd-missing-bin");
      expect(target).toBeTruthy();
      expect(target!.available).toBe(true);
      expect(target!.stderr_excerpt).toContain(
        "short-circuit: permission.bash=allow",
      );
    } finally {
      setPreflightRunnerBashPermissionSource({
        globalBash: undefined,
        agentBash: undefined,
      });
      process.env.XDG_STATE_HOME = prevXdg;
    }
  });

  it("short-circuits all probes as unavailable when permission.bash is ask", async () => {
    const prevXdg = process.env.XDG_STATE_HOME;
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-short-ask-"));
    process.env.XDG_STATE_HOME = xdg;

    try {
      const task = "short-circuit-ask";
      prepareState(task);
      setPreflightRunnerBashPermissionSource({
        globalBash: undefined,
        agentBash: "ask",
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

      const res = JSON.parse(raw) as {
        status: "ok" | "failed";
        results: {
          id: string;
          available: boolean;
          stderr_excerpt: string;
        }[];
      };

      expect(res.status).toBe("failed");
      const target = res.results.find((r) => r.id === "cmd-ls");
      expect(target).toBeTruthy();
      expect(target!.available).toBe(false);
      expect(target!.stderr_excerpt).toContain(
        "short-circuit: permission.bash=ask",
      );
    } finally {
      setPreflightRunnerBashPermissionSource({
        globalBash: undefined,
        agentBash: undefined,
      });
      process.env.XDG_STATE_HOME = prevXdg;
    }
  });
});

describe("preflight-cli agent guardrail", () => {
  // The preflight-cli tool is reserved for orch-planner agent only.
  // When called from other agents, it should return a SPEC_ERROR-style
  // failure with all commands marked as unavailable.

  it("should reject calls from non-orch-planner agents (simulated)", () => {
    // This test verifies the guardrail logic exists in preflight-cli.ts.
    // The actual enforcement happens at runtime by checking context.agent.
    // We verify the logic is present by checking the code structure.
    const preflightCliSource = fs.readFileSync(
      path.resolve(__dirname, "../src/preflight-cli.ts"),
      "utf8",
    );

    // Check that the guardrail check exists
    expect(preflightCliSource).toContain('agentName !== "orch-planner"');
    expect(preflightCliSource).toContain(
      "SPEC_ERROR: preflight-cli may only be called from the orch-planner agent",
    );
  });
});

describe("orchestrator resources migration", () => {
  // Verifies that the schema files have been moved from schema/ to resources/.

  it("should have schema files in resources directory", () => {
    const resourcesDir = path.resolve(__dirname, "../resources");
    expect(fs.existsSync(path.join(resourcesDir, "command-policy.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(resourcesDir, "acceptance-index.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(resourcesDir, "helper-commands.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(resourcesDir, "todo.json"))).toBe(true);
    expect(fs.existsSync(path.join(resourcesDir, "status.json"))).toBe(true);
  });

  it("should no longer have JSON files in schema directory", () => {
    const schemaDir = path.resolve(__dirname, "../schema");
    if (fs.existsSync(schemaDir)) {
      const files = fs.readdirSync(schemaDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      expect(jsonFiles.length).toBe(0);
    }
  });

  it("command-policy.json should have available_helper_commands in schema properties", () => {
    const commandPolicyPath = path.resolve(
      __dirname,
      "../resources/command-policy.json",
    );
    const content = JSON.parse(fs.readFileSync(commandPolicyPath, "utf8"));
    // This is a JSON schema definition file, so we check the schema structure
    expect(
      content.properties?.summary?.properties?.available_helper_commands,
    ).toBeDefined();
  });
});
