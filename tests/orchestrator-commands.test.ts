import { describe, it, expect } from "vitest";

import {
  orchestratorCommands,
  type OrchestratorCommandKey,
} from "../src/orchestrator-commands.js";

describe("orchestratorCommands", () => {
  it("defines expected command keys", () => {
    const keys = Object.keys(orchestratorCommands);
    expect(keys).toContain("orch-todo-write");
    expect(keys).toContain("orch-exec");
    expect(keys).toContain("orch-audit");
    expect(keys).toContain("orch-refine");
    expect(keys).toContain("orch-spec-check");
  });

  it("every command has a description string", () => {
    for (const [name, config] of Object.entries(orchestratorCommands)) {
      expect(typeof config.description).toBe("string");
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  it("every command has an agent field", () => {
    for (const [name, config] of Object.entries(orchestratorCommands)) {
      expect(typeof config.agent).toBe("string");
      expect(config.agent!.length).toBeGreaterThan(0);
    }
  });

  it("agent names reference existing orchestrator agents", () => {
    const validAgents = [
      "orch-todo-writer",
      "orch-executor",
      "orch-auditor",
      "orch-refiner",
      "orch-spec-checker",
    ];
    for (const [name, config] of Object.entries(orchestratorCommands)) {
      expect(validAgents).toContain(config.agent);
    }
  });

  it("only orch-spec-check has subtask=true", () => {
    const subtaskTrue = Object.entries(orchestratorCommands).filter(
      ([_, c]) => c.subtask === true,
    );
    expect(subtaskTrue).toHaveLength(1);
    expect(subtaskTrue[0][0]).toBe("orch-spec-check");
  });

  it("command-agent mapping is correct", () => {
    expect(orchestratorCommands["orch-todo-write"].agent).toBe(
      "orch-todo-writer",
    );
    expect(orchestratorCommands["orch-exec"].agent).toBe("orch-executor");
    expect(orchestratorCommands["orch-audit"].agent).toBe("orch-auditor");
    expect(orchestratorCommands["orch-refine"].agent).toBe("orch-refiner");
    expect(orchestratorCommands["orch-spec-check"].agent).toBe(
      "orch-spec-checker",
    );
  });

  it("OrchestratorCommandKey type covers all keys", () => {
    const key: OrchestratorCommandKey = "orch-exec";
    expect(orchestratorCommands[key]).toBeDefined();
  });
});
