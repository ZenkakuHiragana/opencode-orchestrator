---
name: orch-spec-operational-check
description: Spec-Checker-only operational audit procedure for orch-spec-checker. Use this when evaluating whether the current acceptance/spec/policy state is structurally sound and executable by downstream agents. Do not use for editing, planning summaries, or implementation.
---

# Orchestrator Spec Operational Check

## Purpose

This skill holds the reusable operational audit procedure for
`orch-spec-checker`.

Use it to judge whether the current acceptance/spec/policy state is not only
plausible, but actually usable by Todo-Writer, Executor, and Auditor.

## Intended caller

- `orch-spec-checker`

## Not intended for

- `orch-planner`
- `orch-refiner`
- `orch-todo-writer`
- `orch-executor`
- any editing or command-execution task

## Procedure

1. Validate the acceptance index structurally:
   - required top-level fields
   - stable requirement IDs
   - clear `north_star`
   - non-empty requirement descriptions
2. Check requirement quality, not only presence:
   - clear expected outcome
   - bounded scope
   - concrete evidence hooks
   - decomposition cues for Todo-Writer
   - no vague deferral wording in active requirements
3. Detect structural modeling problems:
   - preconditions mixed into acceptance criteria
   - overlapping requirements that duplicate work
   - missing non-goals or missing boundaries
   - ownership-boundary leaks across acceptance, spec, and command policy
4. Review `command-policy.json` operationally:
   - coverage for major requirements
   - safety of command shapes
   - whether templating is clear and minimal
   - whether availability gaps make the current state infeasible for the loop
5. Look for downstream blockers explicitly:
   - Todo-Writer would have to invent work structure
   - Executor would have to guess target surfaces or verification paths
   - Auditor would lack concrete evidence hooks
6. When the spec references state channels, agent-visible inputs/outputs, CLI
   surfaces, or runtime data flows, cross-check the live repository surfaces
   that define them.
7. Flag stale-model leaks when removed or deprecated channels, fields, or terms
   are still described as active in prompts, docs, schemas, or implementation
   surfaces.
8. Emit conservative, non-overlapping issues that explain the smallest decisive
   next repair.

## Decision standard

- Use `status: "needs_revision"` when structure, feasibility, or downstream
  executability is weak.
- Use `feasible_for_loop: false` when the current state would cause the loop to
  stall, misread intent, or rely on unavailable command paths.
- Prefer one precise issue per root problem over many noisy duplicates.

## Final check

Before you finish, confirm that your report answers all of these:

- Can Todo-Writer decompose this without inventing intent?
- Can Executor act without guessing target surfaces or verification paths?
- Can Auditor point to concrete evidence anchors?
- Do live repository surfaces agree with the documented active model?
