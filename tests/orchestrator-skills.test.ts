import { describe, it, expect } from "vitest";

import {
  buildPackagedSkillGlobalDenyRule,
  mergePermissionRulePreservingExisting,
} from "../src/orchestrator-skills.js";

describe("mergePermissionRulePreservingExisting", () => {
  const denyMap = buildPackagedSkillGlobalDenyRule();

  it("returns the additions when existing is falsy", () => {
    const result = mergePermissionRulePreservingExisting(undefined, denyMap);
    expect(result).toEqual(denyMap);
  });

  it("returns additions when existing is null", () => {
    const result = mergePermissionRulePreservingExisting(null, denyMap);
    expect(result).toEqual(denyMap);
  });

  it("converts a bare string 'allow' with correct key order: wildcard first, then deny", () => {
    const result = mergePermissionRulePreservingExisting(
      "allow",
      denyMap,
    ) as Record<string, string>;
    const keys = Object.keys(result);

    // "*" must be the very first key so that specific deny entries
    // (which come later) override it under last-key-wins resolution.
    expect(keys[0]).toBe("*");
    expect(result["*"]).toBe("allow");

    // Every packaged skill must be denied despite the broad "allow" wildcard.
    for (const skillName of Object.keys(denyMap)) {
      expect(result[skillName]).toBe("deny");
    }
  });

  it("converts a bare string 'deny' with correct key order", () => {
    const result = mergePermissionRulePreservingExisting(
      "deny",
      denyMap,
    ) as Record<string, string>;
    const keys = Object.keys(result);

    expect(keys[0]).toBe("*");
    expect(result["*"]).toBe("deny");
    for (const skillName of Object.keys(denyMap)) {
      expect(result[skillName]).toBe("deny");
    }
  });

  it("merges existing object without wildcard: additions first, user keys last", () => {
    const existing = { "my-custom-skill": "allow" };
    const result = mergePermissionRulePreservingExisting(
      existing,
      denyMap,
    ) as Record<string, string>;

    // User's non-wildcard key should come after additions and override them.
    expect(result["my-custom-skill"]).toBe("allow");
    for (const skillName of Object.keys(denyMap)) {
      expect(result[skillName]).toBe("deny");
    }
  });

  it("reorders existing object wildcard to first position", () => {
    const existing = { "*": "allow", "my-custom-skill": "allow" };
    const result = mergePermissionRulePreservingExisting(
      existing,
      denyMap,
    ) as Record<string, string>;
    const keys = Object.keys(result);

    // "*" must be first, specific deny after it, user non-wildcard keys last.
    expect(keys[0]).toBe("*");
    expect(result["*"]).toBe("allow");

    for (const skillName of Object.keys(denyMap)) {
      expect(result[skillName]).toBe("deny");
    }
    expect(result["my-custom-skill"]).toBe("allow");
  });
});

describe("buildPackagedSkillGlobalDenyRule", () => {
  it("denies every packaged skill", () => {
    const rule = buildPackagedSkillGlobalDenyRule();
    expect(rule["orch-planner-gate-cycle"]).toBe("deny");
    expect(rule["orch-refiner-evidence-design"]).toBe("deny");
    expect(rule["orch-spec-operational-check"]).toBe("deny");
    expect(rule["orch-todo-decomposition"]).toBe("deny");
    expect(rule["orch-executor-implementation"]).toBe("deny");
    expect(rule["orch-executor-completion-review"]).toBe("deny");
  });

  it("does not include a wildcard key", () => {
    const rule = buildPackagedSkillGlobalDenyRule();
    expect(rule["*"]).toBeUndefined();
  });
});

describe("buildSkillPermission key order", () => {
  it("places wildcard deny before specific allows", async () => {
    // Import dynamically to exercise the actual function.
    const { buildSkillPermission, orchestratorAgentSkillAllowlist } =
      await import("../src/orchestrator-skills.js");
    const allowed = orchestratorAgentSkillAllowlist["orch-executor"] ?? [];
    const result = buildSkillPermission(allowed) as Record<string, string>;
    const keys = Object.keys(result);

    // "*": "deny" must come first so that specific allow entries override it.
    expect(keys[0]).toBe("*");
    expect(result["*"]).toBe("deny");
    expect(result["orch-executor-implementation"]).toBe("allow");
    expect(result["orch-executor-completion-review"]).toBe("allow");
  });
});
