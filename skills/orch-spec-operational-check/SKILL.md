# Skill: orch-spec-operational-check

Use this skill for the detailed operational analysis performed by Spec-Checker.

## Acceptance checks

- Validate structure, required fields, id quality, and internal consistency of `acceptance-index.json`.
- Flag requirements that are too broad, overlap excessively, lack evidence hooks, or lack decomposition cues.
- Require a meaningful `north_star` that aligns with the requirements.
- Flag vague deferral wording and require structural modeling of out-of-scope or future work.

## Preconditions vs acceptance

- Distinguish task deliverables from orchestrator preconditions.
- Report structural issues when acceptance criteria are really about planner state, command-policy shape, or other pre-existing orchestration conditions.

## Command-policy checks

- Check command coverage, requirement mapping, safety, templating quality, and command sprawl.
- Flag wrappers, shell composition, redirections, or other unsafe command definitions.
- Treat missing or unavailable commands for major requirements as feasibility issues.
- Validate explicit `exec` entries for scope, necessity, and evidence linkage.

## Feasibility

- Set `feasible_for_loop` conservatively.
- Bias toward `false` when major requirements lack a realistic verification path, required commands are unavailable, or the specification would force downstream guessing.

## Decision standard

- Prefer conservative `needs_revision` results over unsupported optimism.
- Keep issues non-overlapping and actionable.
- When specs mention state channels, agent-visible inputs/outputs, CLI surfaces, or runtime data flows, cross-check the corresponding live repository surfaces for stale or contradictory descriptions.
