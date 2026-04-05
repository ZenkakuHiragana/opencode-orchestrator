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
    expect(config.permission.skill).toEqual(
      expect.objectContaining({
        "orch-planner-gate-cycle": "deny",
        "orch-refiner-evidence-design": "deny",
        "orch-spec-operational-check": "deny",
        "orch-todo-decomposition": "deny",
        "orch-executor-implementation": "deny",
        "orch-executor-completion-review": "deny",
      }),
    );
    expect(config.agent["orch-executor"].permission.skill).toEqual(
      expect.objectContaining({
        "*": "deny",
        "orch-executor-implementation": "allow",
        "orch-executor-completion-review": "allow",
      }),
    );
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

  it("overrides string permission.skill with packaged deny map", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      permission: {
        skill: "allow",
      },
    };
    await plugin.config!(config);

    // When the user has permission.skill: "allow" (a bare string), the
    // packaged deny map must still be injected so that orchestrator skill
    // names are hidden by default.
    expect(typeof config.permission.skill).toBe("object");
    expect(config.permission.skill).not.toBe("allow");

    // OpenCode resolves permission.skill last-key-wins, so the wildcard
    // MUST be the first key.  Specific deny entries come after and win.
    const keys = Object.keys(config.permission.skill);
    expect(keys[0]).toBe("*");
    expect(config.permission.skill["*"]).toBe("allow");
    expect(config.permission.skill).toEqual(
      expect.objectContaining({
        "orch-planner-gate-cycle": "deny",
        "orch-refiner-evidence-design": "deny",
        "orch-executor-implementation": "deny",
        "orch-executor-completion-review": "deny",
      }),
    );
  });

  it("executor prompt explicitly names both skills", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const prompt: string = config.agent["orch-executor"].prompt;
    expect(prompt).toContain("orch-executor-implementation");
    expect(prompt).toContain("orch-executor-completion-review");
  });
});
