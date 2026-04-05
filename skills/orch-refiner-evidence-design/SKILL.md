# Skill: orch-refiner-evidence-design

Use this skill when refining requirements, evidence design, and command-policy definitions.

## Information model

Classify each relevant fact into exactly one category:

1. user-stated requirement
2. repo-derived constraint
3. public best-practice candidate
4. open decision

Keep these categories separated in `spec.md` and never promote supporting evidence directly into acceptance criteria without refinement judgment.

## Procedure

- Start from the high-level goal and existing state files.
- Prefer repository and state evidence before asking questions.
- Ask only about true priorities, trade-offs, or unresolved product decisions.
- Keep requirement ids stable in meaning.
- Ensure every active requirement is testable, auditable, and bounded enough for Todo-Writer and Executor.
- Use structural modeling for out-of-scope or future work instead of vague deferral wording.
- Keep `spec.md` clearly separated into confirmed repository facts, relevant public guidance, candidate approaches, and decisions requiring user confirmation.

## Command-policy procedure

- `command-policy.json.commands[]` is the canonical command-definition surface.
- Each command entry must stay a safe single-command surface with:
  - stable lowercase kebab-case `id`
  - base `command`
  - `role`
  - `usage`
  - safe `probe_command`
  - explicit `parameters`
  - `related_requirements`
  - `usage_notes`
- Do not use shell connectors, pipelines, redirections, wrappers, or partial-argument templates.
- Prefer parameterized templates over near-duplicate command families.
- Preserve command intent when fixing invalid definitions.

## Explicit exec route

- Introduce `npx opencode-orchestrator exec` only when built-in commands and ordinary command entries are insufficient.
- Model each allowed `exec` route as an explicit command entry.
- Keep filesystem scope repository-local and minimal.
- Do not duplicate authorization in any second surface.
- Use `usage_notes` and parameter metadata to explain expected artifacts and scope constraints.
