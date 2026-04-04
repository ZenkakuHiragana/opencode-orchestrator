import { describe, it, expect } from "vitest";

import {
  agentUsesSkillTool,
  buildPackagedSkillGlobalDenyRule,
  buildSkillPermission,
  mergePermissionConfigPreservingExisting,
  mergePermissionRulePreservingExisting,
  orchestratorAgentSkillAllowlist,
  packagedOrchestratorSkillNames,
} from "../src/orchestrator-skills.js";

describe("orchestrator skills metadata", () => {
  it("defines the packaged orchestrator skill names", () => {
    expect(packagedOrchestratorSkillNames).toEqual([
      "orch-planner-gate-cycle",
      "orch-refiner-evidence-design",
      "orch-spec-operational-check",
      "orch-todo-decomposition",
    ]);
  });

  it("builds per-agent skill allowlists", () => {
    expect(orchestratorAgentSkillAllowlist["orch-planner"]).toEqual([
      "orch-planner-gate-cycle",
    ]);
    expect(orchestratorAgentSkillAllowlist["orch-executor"]).toEqual([
      "implementation",
      "completion-review",
    ]);
    expect(orchestratorAgentSkillAllowlist["orch-auditor"]).toEqual([]);
  });

  it("enables the skill tool only for agents with allowed skills", () => {
    expect(agentUsesSkillTool("orch-planner")).toBe(true);
    expect(agentUsesSkillTool("orch-refiner")).toBe(true);
    expect(agentUsesSkillTool("orch-todo-writer")).toBe(true);
    expect(agentUsesSkillTool("orch-executor")).toBe(true);
    expect(agentUsesSkillTool("orch-spec-checker")).toBe(true);
    expect(agentUsesSkillTool("orch-auditor")).toBe(false);
    expect(agentUsesSkillTool("orch-local-investigator")).toBe(false);
  });

  it("builds skill permission allowlists with default deny", () => {
    expect(buildSkillPermission([])).toBe("deny");
    expect(
      buildSkillPermission(["implementation", "completion-review"]),
    ).toEqual({
      "*": "deny",
      implementation: "allow",
      "completion-review": "allow",
    });
  });

  it("builds a global deny rule for packaged orchestrator skills", () => {
    expect(buildPackagedSkillGlobalDenyRule()).toEqual({
      "orch-planner-gate-cycle": "deny",
      "orch-refiner-evidence-design": "deny",
      "orch-spec-operational-check": "deny",
      "orch-todo-decomposition": "deny",
    });
  });

  it("preserves existing scalar permission rules", () => {
    expect(
      mergePermissionRulePreservingExisting("allow", {
        "orch-planner-gate-cycle": "deny",
      }),
    ).toBe("allow");
  });

  it("merges object permission rules without losing existing entries", () => {
    expect(
      mergePermissionRulePreservingExisting(
        {
          custom: "allow",
          "orch-planner-gate-cycle": "allow",
        },
        {
          "orch-planner-gate-cycle": "deny",
          "orch-refiner-evidence-design": "deny",
        },
      ),
    ).toEqual({
      "orch-planner-gate-cycle": "allow",
      "orch-refiner-evidence-design": "deny",
      custom: "allow",
    });
  });

  it("merges permission config objects while preserving existing overrides", () => {
    expect(
      mergePermissionConfigPreservingExisting(
        {
          skill: {
            "*": "deny",
            implementation: "allow",
          },
          task: {
            "*": "deny",
            explore: "allow",
          },
        },
        {
          skill: {
            implementation: "deny",
            custom: "allow",
          },
          bash: "allow",
        },
      ),
    ).toEqual({
      skill: {
        "*": "deny",
        implementation: "deny",
        custom: "allow",
      },
      task: {
        "*": "deny",
        explore: "allow",
      },
      bash: "allow",
    });
  });
});
