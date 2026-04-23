import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OrchestratorPlugin } from "../src/index.js";
import { getOpencodeClient } from "../src/opencode-client-store.js";

describe("OrchestratorPlugin", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ["node", "test.js"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("registers preflight-cli tool by default", async () => {
    const client = { tag: "client" };
    const plugin = await OrchestratorPlugin({ client } as any);
    expect(getOpencodeClient()).toBe(client);
    expect(plugin.tool).toHaveProperty("autocommit");
    expect(plugin.tool).toHaveProperty("orch_todo_read");
    expect(plugin.tool).toHaveProperty("orch_todo_write");
    expect(plugin.tool).toHaveProperty("preflight-cli");
  });

  // NOTE: preflight-cli is always registered; we no longer special-case
  // orch-preflight command sessions here.

  it("wires orchestrator agents and commands into config", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    expect(typeof plugin.config).toBe("function");
    await plugin.config!(config);

    expect(typeof config.agent).toBe("object");
    expect(typeof config.command).toBe("object");

    expect(config.agent["orch-executor"]).toBeTruthy();
    expect(typeof config.agent["orch-executor"].prompt).toBe("string");
    expect(config.command["orch-exec"]).toBeTruthy();
    expect(typeof config.command["orch-exec"].template).toBe("string");
  });

  it("embeds helper command JSON into planner/spec-checker prompts", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    for (const agentName of ["orch-planner", "orch-spec-checker"]) {
      const prompt = config.agent[agentName]?.prompt;
      expect(typeof prompt).toBe("string");
      expect(prompt).toContain("helper_commands");
      expect(prompt).toContain('"id": "helper:rg"');
      expect(prompt).toContain('"command": "rg"');
      expect(prompt).toContain('"id": "helper:jq"');
      expect(prompt).toContain('"command": "jq"');
    }
  });

  it("does not embed helper command JSON into executor prompt", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const prompt = config.agent["orch-executor"]?.prompt;
    expect(typeof prompt).toBe("string");
    expect(prompt).not.toContain(
      "Predefined helper commands (available for shell composition)",
    );
    // Executor should not see the helper-commands schema JSON itself
    // (resources/helper-commands.json), but it MAY see
    // "available_helper_commands" from the command-policy schema.
    expect(prompt).not.toContain('"helper_commands"');
  });

  it("removes command-policy concepts from execution-phase prompts in skip-command-policy mode", async () => {
    const previous = process.env.OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY;
    process.env.OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY = "1";

    try {
      const plugin = await OrchestratorPlugin({ client: {} } as any);
      const config: any = {};
      await plugin.config!(config);

      const executorPrompt = config.agent["orch-executor"]?.prompt;
      const todoWriterPrompt = config.agent["orch-todo-writer"]?.prompt;
      const execTemplate = config.command["orch-exec"]?.template;

      expect(typeof executorPrompt).toBe("string");
      expect(typeof todoWriterPrompt).toBe("string");
      expect(typeof execTemplate).toBe("string");

      expect(executorPrompt).toContain(
        "When no explicit command catalog is attached",
      );
      expect(executorPrompt).toContain(
        "report `-` in `STEP_CMD` / `STEP_VERIFY` command-id slots whenever no current command id exists",
      );
      expect(executorPrompt).not.toContain(
        "Treat `command-policy.json` as the **single source of truth** for allowed commands and helpers.",
      );
      expect(executorPrompt).not.toContain(
        "You may compose shell scripts **only** from commands explicitly allowed by this task’s `command-policy.json`.",
      );
      expect(executorPrompt).not.toContain("command-policy");
      expect(todoWriterPrompt).not.toContain("command-policy");
      expect(execTemplate).not.toContain("command-policy");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY;
      } else {
        process.env.OPENCODE_ORCH_EXEC_SKIP_COMMAND_POLICY = previous;
      }
    }
  });

  it("keeps description when permission.orchestrator is allow", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      permission: {
        orchestrator: {
          "orch-local-investigator": "allow",
        },
      },
    };
    await plugin.config!(config);

    expect(config.agent["orch-local-investigator"]).toBeTruthy();
    expect(typeof config.agent["orch-local-investigator"].description).toBe(
      "string",
    );
  });

  it("wires updated todo-writer command text and agent descriptions into config", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      permission: {
        orchestrator: {
          "orch-auditor": "allow",
          "orch-local-investigator": "allow",
          "orch-public-researcher": "allow",
        },
      },
    };
    await plugin.config!(config);

    expect(config.command["orch-todo-write"].template).toContain(
      "Prefer incremental replanning over full regeneration",
    );
    expect(config.command["orch-todo-write"].description).toBe(
      "Orchestrator todo planning/replanning step",
    );
    expect(config.agent["orch-auditor"].description).toBe(
      "Strict read-only verifier for orchestrator runs",
    );
    expect(config.agent["orch-local-investigator"].description).toContain(
      "Repository-local investigation specialist",
    );
    expect(config.agent["orch-public-researcher"].description).toContain(
      "Non-interactive public information research specialist",
    );
  });
});
