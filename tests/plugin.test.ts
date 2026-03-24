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

  it("registers preflight-cli tool when not running orch-preflight", async () => {
    const client = { tag: "client" };
    const plugin = await OrchestratorPlugin({ client } as any);
    expect(getOpencodeClient()).toBe(client);
    expect(plugin.tool).toHaveProperty("autocommit");
    expect(plugin.tool).toHaveProperty("orch_todo_read");
    expect(plugin.tool).toHaveProperty("orch_todo_write");
    expect(plugin.tool).toHaveProperty("preflight-cli");
  });

  it("omits preflight-cli tool inside orch-preflight command session", async () => {
    process.argv = ["node", "x", "run", "--command", "orch-preflight"];
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    expect(plugin.tool).toHaveProperty("autocommit");
    expect(plugin.tool).not.toHaveProperty("preflight-cli");
  });

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

  it("embeds helper command JSON into required agent prompts", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    for (const agentName of [
      "orch-refiner",
      "orch-planner",
      "orch-spec-checker",
    ]) {
      const prompt = config.agent[agentName]?.prompt;
      expect(typeof prompt).toBe("string");
      expect(prompt).toContain(
        "Predefined helper commands (available for shell composition)",
      );
      expect(prompt).toContain("helper_commands");
      expect(prompt).toContain('"id": "helper:rg"');
      expect(prompt).toContain('"command": "rg {{params}}"');
      expect(prompt).toContain('"id": "helper:jq"');
      expect(prompt).toContain('"command": "jq {{params}}"');
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
    expect(prompt).not.toContain("helper_commands");
    expect(prompt).not.toContain('"command": "rg {{params}}"');
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
});
