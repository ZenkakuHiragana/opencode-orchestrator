import { describe, it, expect } from "vitest";

import {
  orchestratorAgents,
  type OrchestratorAgentKey,
} from "../src/orchestrator-agents.js";

describe("orchestratorAgents", () => {
  it("defines expected agent keys", () => {
    const keys = Object.keys(orchestratorAgents);
    expect(keys).toContain("orch-planner");
    expect(keys).toContain("orch-refiner");
    expect(keys).toContain("orch-todo-writer");
    expect(keys).toContain("orch-executor");
    expect(keys).toContain("orch-auditor");
    expect(keys).toContain("orch-spec-checker");
    expect(keys).toContain("orch-local-investigator");
    expect(keys).toContain("orch-public-researcher");
  });

  it("every agent has a description string", () => {
    for (const [name, config] of Object.entries(orchestratorAgents)) {
      expect(typeof config.description).toBe("string");
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  it("every agent has a mode field", () => {
    const validModes = ["primary", "subagent"];
    for (const [name, config] of Object.entries(orchestratorAgents)) {
      expect(validModes).toContain(config.mode);
    }
  });

  it("every agent has a tools object", () => {
    for (const [name, config] of Object.entries(orchestratorAgents)) {
      expect(typeof config.tools).toBe("object");
      expect(config.tools).not.toBeNull();
    }
  });

  it("every agent has a permission object", () => {
    for (const [name, config] of Object.entries(orchestratorAgents)) {
      expect(typeof config.permission).toBe("object");
      expect(config.permission).not.toBeNull();
    }
  });

  it("orch-planner is the only primary agent", () => {
    const primaries = Object.entries(orchestratorAgents).filter(
      ([_, c]) => c.mode === "primary",
    );
    expect(primaries).toHaveLength(1);
    expect(primaries[0][0]).toBe("orch-planner");
  });

  it("orch-auditor has read-only tools (edit/write/patch disabled)", () => {
    const auditor = orchestratorAgents["orch-auditor"];
    expect(auditor.tools.edit).toBe(false);
    expect(auditor.tools.write).toBe(false);
    expect(auditor.tools.patch).toBe(false);
  });

  it("orch-auditor bash permission denies dangerous git commands", () => {
    const bash = orchestratorAgents["orch-auditor"].permission.bash;
    expect(bash).toEqual(expect.objectContaining({ "git add *": "deny" }));
    expect(bash).toEqual(expect.objectContaining({ "git commit *": "deny" }));
    expect(bash).toEqual(
      expect.objectContaining({ "git reset --hard": "deny" }),
    );
    expect(bash).toEqual(expect.objectContaining({ "git push *": "deny" }));
  });

  it("orch-auditor bash permission allows safe git read commands", () => {
    const bash = orchestratorAgents["orch-auditor"].permission.bash;
    expect(bash).toEqual(expect.objectContaining({ "git status": "allow" }));
    expect(bash).toEqual(expect.objectContaining({ "git diff": "allow" }));
    expect(bash).toEqual(expect.objectContaining({ "git log": "allow" }));
    expect(bash).toEqual(
      expect.objectContaining({ "git branch --show-current": "allow" }),
    );
  });

  it("orch-executor has broad tool access", () => {
    const executor = orchestratorAgents["orch-executor"];
    expect(executor.tools.bash).toBe(true);
    expect(executor.tools.edit).toBe(true);
    expect(executor.tools.write).toBe(true);
    expect(executor.tools.read).toBe(true);
    expect(executor.tools.task).toBe(true);
    expect(executor.tools.webfetch).toBe(true);
    expect(executor.tools.websearch).toBe(true);
  });

  it("orch-spec-checker has read-only tools", () => {
    const checker = orchestratorAgents["orch-spec-checker"];
    expect(checker.tools.bash).toBe(false);
    expect(checker.tools.edit).toBe(false);
    expect(checker.tools.write).toBe(false);
    expect(checker.tools.read).toBe(true);
    expect(checker.tools.glob).toBe(true);
    expect(checker.tools.grep).toBe(true);
  });

  it("subagents with hidden=true are properly marked", () => {
    const hiddenAgents = Object.entries(orchestratorAgents).filter(
      ([_, c]) => c.hidden === true,
    );
    const names = hiddenAgents.map(([n]) => n);
    expect(names).toContain("orch-refiner");
    expect(names).toContain("orch-todo-writer");
    expect(names).toContain("orch-executor");
    expect(names).toContain("orch-auditor");
    expect(names).toContain("orch-spec-checker");
  });

  it("non-hidden agents are visible in agent list", () => {
    const visible = Object.entries(orchestratorAgents).filter(
      ([_, c]) => c.hidden !== true,
    );
    const names = visible.map(([n]) => n);
    expect(names).toContain("orch-planner");
    expect(names).toContain("orch-local-investigator");
    expect(names).toContain("orch-public-researcher");
  });

  it("OrchestratorAgentKey type covers all keys", () => {
    // Type-level check: ensure the union type is derived correctly
    const key: OrchestratorAgentKey = "orch-planner";
    expect(orchestratorAgents[key]).toBeDefined();
  });
});
