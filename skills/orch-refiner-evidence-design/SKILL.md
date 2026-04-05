---
name: orch-refiner-evidence-design
description: Refiner-only requirement-to-evidence design procedure for orch-refiner. Use this when turning goals into acceptance state, specification text, and command definitions. Do not use for planning summaries, todo decomposition, implementation work, or execution-phase completion.
---

# Orchestrator Refiner Evidence Design

## Purpose

This skill holds the reusable refinement procedure for `orch-refiner`.

Use it to turn a high-level goal into stable requirements, explicit evidence
hooks, and command definitions that downstream agents can follow without
guessing.

## Intended caller

- `orch-refiner`

## Not intended for

- `orch-planner`
- `orch-spec-checker`
- `orch-todo-writer`
- `orch-executor`
- direct code, test, or configuration edits in the repository

## Operating posture

- Prefer repository and existing-state evidence before asking the human.
- Ask only about real priorities, trade-offs, or product decisions that cannot
  be derived locally.
- Treat refinement as incomplete until the canonical state files are rewritten
  and re-read.

## Information model

Classify every important input into exactly one of:

1. user-stated requirement
2. repo-derived constraint
3. relevant public guidance
4. open decision

Use these classes to keep acceptance criteria separate from supporting evidence
and unresolved choices.

## Procedure

1. Read the current goal, existing task state, and relevant repository context.
2. Identify what is already explicit, what is merely implied by the repository,
   and what still needs a user decision.
3. Rewrite or normalize the `north_star` so it states the task's highest-value
   outcome in 1-2 lines.
4. Build or revise stable requirements so that each requirement has:
   - a clear expected outcome
   - a bounded scope
   - an obvious evidence hook for audit
   - a shape that Todo-Writer can decompose without inventing missing intent
5. Split or sharpen requirements when a single requirement would otherwise force
   downstream agents to guess work slicing, verification, or non-goals.
6. Keep out-of-scope work structural:
   - use explicit non-goals
   - use separate future requirements when needed
   - do not rely on vague deferral wording inside active requirements
7. Write `spec.md` so that it clearly separates:
   - confirmed repository facts
   - relevant public guidance
   - candidate approaches
   - decisions requiring user confirmation
   - execution-phase completion heuristics do not belong here
8. Design command definitions only when they are needed to support exploration,
   implementation, or verification.
9. Prefer the smallest command surface that still gives downstream agents a real
   verification path.
10. Use explicit `npx opencode-orchestrator exec` commands only when simpler
    built-in or helper commands cannot provide the required mechanical evidence.
11. When `exec` is needed, keep filesystem scope minimal and repository-local.
12. Rewrite `acceptance-index.json`, `spec.md`, and `command-policy.json`
    together so that they remain aligned.
13. Re-open every rewritten file and confirm the persisted state matches the
    refined intent.

## Downstream quality bar

Before you finish, make sure the resulting state answers all of these:

- What matters most for this task?
- What must be true for acceptance?
- What is explicitly out of scope?
- What proof could an auditor inspect?
- What command or artifact path exists when mechanical verification matters?
- What still requires a human decision?
