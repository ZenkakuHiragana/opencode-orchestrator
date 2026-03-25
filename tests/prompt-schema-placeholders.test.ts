import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OrchestratorPlugin } from "../src/index.js";

describe("prompt JSON schema placeholders", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ["node", "test.js"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("expands schema placeholders for refiner/spec-checker/planner", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const agents = [
      "orch-refiner",
      "orch-planner",
      "orch-spec-checker",
    ] as const;

    for (const name of agents) {
      const prompt = config.agent[name]?.prompt as string | undefined;
      expect(typeof prompt).toBe("string");
      // Placeholders should have been expanded to real JSON, so they must not
      // appear in the final prompt.
      expect(prompt).not.toContain("$ACCEPTANCE_INDEX_SCHEMA");
      expect(prompt).not.toContain("$COMMAND_POLICY_SCHEMA");
      expect(prompt).not.toContain("$HELPER_COMMANDS_SCHEMA");

      if (name === "orch-refiner" || name === "orch-spec-checker") {
        // Refiner/Spec-Checker should see both acceptance-index and command-policy schemas.
        expect(prompt).toContain("AcceptanceIndex");
        expect(prompt).toContain("CommandPolicy");
        // Helper commands JSON should also be present.
        expect(prompt).toContain('"helper_commands"');
        expect(prompt).toContain('"id": "helper:rg"');
        expect(prompt).toContain('"command": "rg"');
      }

      if (name === "orch-planner") {
        // Planner should see command-policy + helper-commands but not acceptance-index schema.
        expect(prompt).not.toContain('"title": "AcceptanceIndex"');
        expect(prompt).toContain('"title": "CommandPolicy"');
        expect(prompt).toContain('"helper_commands"');
      }
    }
  });

  it("does not leak helper-commands schema JSON into executor prompt", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const prompt = config.agent["orch-executor"]?.prompt as string | undefined;
    expect(typeof prompt).toBe("string");

    // Executor should not see the helper-commands schema JSON itself
    // (resources/helper-commands.json), but it MAY see
    // "available_helper_commands" from the command-policy schema.
    expect(prompt).not.toContain("$HELPER_COMMANDS_SCHEMA");
    expect(prompt).not.toContain('"helper_commands"');
    expect(prompt).not.toContain('"id": "helper:rg"');
    expect(prompt).not.toContain('"command": "rg"');
    expect(prompt).toContain("available_helper_commands");
  });
});
