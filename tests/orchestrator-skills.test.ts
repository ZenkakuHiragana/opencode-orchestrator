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

  it("merges additions under an existing object rule", () => {
    const existing = { "my-custom-skill": "allow" };
    const result = mergePermissionRulePreservingExisting(existing, denyMap);
    expect(result).toEqual({
      ...denyMap,
      "my-custom-skill": "allow",
    });
  });

  it("converts a bare string 'allow' into a map with per-skill deny and wildcard fallback", () => {
    const result = mergePermissionRulePreservingExisting("allow", denyMap);
    expect(result).toEqual({
      ...denyMap,
      "*": "allow",
    });
    // Every packaged skill must be denied despite the broad "allow" wildcard.
    for (const skillName of Object.keys(denyMap)) {
      expect((result as Record<string, string>)[skillName]).toBe("deny");
    }
  });

  it("converts a bare string 'deny' into a map with per-skill deny and wildcard fallback", () => {
    const result = mergePermissionRulePreservingExisting("deny", denyMap);
    expect(result).toEqual({
      ...denyMap,
      "*": "deny",
    });
  });

  it("returns additions when existing is null", () => {
    const result = mergePermissionRulePreservingExisting(null, denyMap);
    expect(result).toEqual(denyMap);
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
