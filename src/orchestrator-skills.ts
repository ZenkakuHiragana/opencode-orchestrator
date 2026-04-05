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
  "orch-executor-implementation",
  "orch-executor-completion-review",
] as const;

export const orchestratorAgentSkillAllowlist: Record<string, string[]> = {
  "orch-planner": ["orch-planner-gate-cycle"],
  "orch-refiner": ["orch-refiner-evidence-design"],
  "orch-todo-writer": ["orch-todo-decomposition"],
  "orch-executor": [
    "orch-executor-implementation",
    "orch-executor-completion-review",
  ],
  "orch-auditor": [],
  "orch-spec-checker": ["orch-spec-operational-check"],
  "orch-local-investigator": [],
  "orch-public-researcher": [],
};

export function buildSkillPermission(
  allowedSkills: readonly string[],
): string | Record<string, string> {
  if (allowedSkills.length === 0) {
    return "deny";
  }

  return {
    "*": "deny",
    ...Object.fromEntries(
      allowedSkills.map((skillName) => [skillName, "allow"]),
    ),
  };
}

export function buildPackagedSkillGlobalDenyRule(): Record<string, string> {
  return Object.fromEntries(
    packagedOrchestratorSkillNames.map((skillName) => [skillName, "deny"]),
  );
}

export function mergePermissionRulePreservingExisting(
  existing: unknown,
  additions: Record<string, string>,
): unknown {
  if (!existing) {
    return { ...additions };
  }

  if (typeof existing === "string") {
    return existing;
  }

  return {
    ...additions,
    ...(existing as Record<string, string>),
  };
}

export function mergePermissionConfigPreservingExisting(
  basePermission: Record<string, unknown> | undefined,
  existingPermission: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
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
        ...(baseValue as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export function agentUsesSkillTool(agentName: string): boolean {
  const allowedSkills = orchestratorAgentSkillAllowlist[agentName] ?? [];
  return allowedSkills.length > 0;
}
