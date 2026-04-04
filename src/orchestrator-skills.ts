// Packaged orchestrator skills are exposed through OpenCode's `permission.skill`
// mechanism. Upstream uses that permission both to decide which skills appear in
// the agent's available-skills system prompt and to gate actual `skill` tool
// execution.
//
// The current plugin hook surface lets us wire skill availability per agent, but
// it does not provide a per-session skill-pattern override. The strongest
// practical runtime control is therefore:
//   1. enable the `skill` tool only on agents that should ever load skills, and
//   2. narrow `permission.skill` to a small per-agent allowlist.

export const ORCHESTRATOR_SKILLS_DIRNAME = "skills";

export const packagedOrchestratorSkillNames = [
  "orch-planner-gate-cycle",
  "orch-refiner-evidence-design",
  "orch-spec-operational-check",
  "orch-todo-decomposition",
] as const;

export type PermissionRuleConfig =
  | "allow"
  | "deny"
  | "ask"
  | Record<string, "allow" | "deny" | "ask">;

export type PermissionConfigObject = Record<string, PermissionRuleConfig>;

export const orchestratorAgentSkillAllowlist = {
  "orch-planner": ["orch-planner-gate-cycle"],
  "orch-refiner": ["orch-refiner-evidence-design"],
  "orch-todo-writer": ["orch-todo-decomposition"],
  "orch-executor": ["implementation", "completion-review"],
  "orch-auditor": [],
  "orch-spec-checker": ["orch-spec-operational-check"],
  "orch-local-investigator": [],
  "orch-public-researcher": [],
} as const satisfies Record<string, readonly string[]>;

export function buildSkillPermission(
  allowedSkills: readonly string[],
): "deny" | Record<string, "allow" | "deny"> {
  if (allowedSkills.length === 0) {
    return "deny";
  }

  return {
    "*": "deny",
    ...Object.fromEntries(
      allowedSkills.map((skillName) => [skillName, "allow"] as const),
    ),
  };
}

export function buildPackagedSkillGlobalDenyRule(): Record<string, "deny"> {
  return Object.fromEntries(
    packagedOrchestratorSkillNames.map(
      (skillName) => [skillName, "deny"] as const,
    ),
  );
}

export function mergePermissionRulePreservingExisting(
  existing: PermissionRuleConfig | undefined,
  additions: Record<string, "allow" | "deny" | "ask">,
): PermissionRuleConfig {
  if (!existing) {
    return { ...additions };
  }

  if (typeof existing === "string") {
    return existing;
  }

  return {
    ...additions,
    ...existing,
  };
}

export function mergePermissionConfigPreservingExisting(
  basePermission: PermissionConfigObject | undefined,
  existingPermission: PermissionConfigObject | undefined,
): PermissionConfigObject {
  const merged: PermissionConfigObject = {
    ...(basePermission ?? {}),
  };

  for (const [key, value] of Object.entries(existingPermission ?? {})) {
    const baseValue = merged[key];

    if (
      baseValue &&
      typeof baseValue === "object" &&
      value &&
      typeof value === "object"
    ) {
      merged[key] = {
        ...baseValue,
        ...value,
      };
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export function agentUsesSkillTool(agentName: string): boolean {
  const allowedSkills =
    orchestratorAgentSkillAllowlist[
      agentName as keyof typeof orchestratorAgentSkillAllowlist
    ] ?? [];
  return allowedSkills.length > 0;
}
