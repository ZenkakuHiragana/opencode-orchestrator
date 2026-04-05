import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OrchestratorPlugin } from "../src/index.js";

describe("OrchestratorPlugin skill wiring", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ["node", "test.js"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("sets global skill deny defaults and per-agent allowlists", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    expect(config.permission.skill).toEqual(
      expect.objectContaining({
        "orch-planner-gate-cycle": "deny",
        "orch-refiner-evidence-design": "deny",
        "orch-spec-operational-check": "deny",
        "orch-todo-decomposition": "deny",
      }),
    );
  });

  it("wires per-agent skill allowlists", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    expect(config.agent["orch-planner"].permission.skill).toEqual({
      "*": "deny",
      "orch-planner-gate-cycle": "allow",
    });
    expect(config.agent["orch-refiner"].permission.skill).toEqual({
      "*": "deny",
      "orch-refiner-evidence-design": "allow",
    });
    expect(config.agent["orch-todo-writer"].permission.skill).toEqual({
      "*": "deny",
      "orch-todo-decomposition": "allow",
    });
    expect(config.agent["orch-spec-checker"].permission.skill).toEqual({
      "*": "deny",
      "orch-spec-operational-check": "allow",
    });
    expect(config.agent["orch-executor"].permission.skill).toEqual({
      "*": "deny",
      implementation: "allow",
      "completion-review": "allow",
    });
    expect(config.agent["orch-auditor"].permission.skill).toBe("deny");
  });

  it("documents executor-only skills on orch-executor", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const prompt = config.agent["orch-executor"]?.prompt as string | undefined;
    expect(prompt).toContain("implementation");
    expect(prompt).toContain("completion-review");
    expect(prompt).toContain("Executor-only");
  });

  it("preserves user-provided global and agent skill overrides", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {
      skills: {
        paths: ["C:/custom/skills"],
      },
      permission: {
        skill: {
          custom: "allow",
          "orch-planner-gate-cycle": "allow",
        },
      },
      agent: {
        "orch-executor": {
          permission: {
            skill: {
              implementation: "deny",
              customExecSkill: "allow",
            },
          },
        },
      },
    };
    await plugin.config!(config);

    expect(config.permission.skill).toEqual(
      expect.objectContaining({
        custom: "allow",
        "orch-planner-gate-cycle": "allow",
        "orch-refiner-evidence-design": "deny",
      }),
    );
    expect(config.agent["orch-executor"].permission.skill).toEqual({
      "*": "deny",
      implementation: "deny",
      "completion-review": "allow",
      customExecSkill: "allow",
    });
    expect(config.skills.paths).toEqual(["C:/custom/skills"]);
  });
});
