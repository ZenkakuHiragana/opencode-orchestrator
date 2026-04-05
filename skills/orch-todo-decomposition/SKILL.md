---
name: orch-todo-decomposition
description: Todo-Writer-only decomposition procedure for orch-todo-writer. Use this when deriving or revising canonical todos from accepted requirements. Do not use for acceptance design, implementation work, execution-phase completion, or general planning summaries.
---

# Orchestrator Todo Decomposition

## Purpose

This skill holds the reusable canonical-todo design procedure for
`orch-todo-writer`.

Use it to produce executor-feasible, audit-friendly todos that cover every
in-scope requirement without forcing downstream re-planning.

## Intended caller

- `orch-todo-writer`

## Not intended for

- `orch-planner`
- `orch-refiner`
- `orch-spec-checker`
- `orch-executor`
- any code-editing or command-running task

## Procedure

1. Start from the Refiner-owned requirement state:
   - `acceptance-index.json`
   - `spec.md`
2. Read existing canonical todos, `status.json`, and `proposals.json` before
   deciding whether to add, update, or replace structure.
3. Preserve active coverage:
   - every in-scope requirement needs at least one active todo
   - do not remove active coverage through invented phases or convenience
     cancellation
4. Prefer small vertical slices over giant horizontal buckets.
5. Identify bridge work explicitly when it is required for acceptance, such as:
   - tests
   - documentation
   - prompt wiring
   - configuration updates
   - verification or evidence capture
6. Make todos decision-complete for Executor:
   - clear work surface
   - clear requirement mapping
   - clear completion boundary
   - clear evidence boundary when risk or audit sensitivity is high
7. Use `execution_contract` to remove downstream guesswork:
   - `intent`
   - `expected_evidence`
   - `command_ids`
   - `audit_ready_when`
   - artifact schema and filename when investigation or verification outputs are
     required
8. When auditor feedback exists, translate `failure_kind` and `evidence_gaps`
   into real structural todo changes. Do not accept a no-op replan.
9. When command-policy gaps make a todo impossible, do not create an impossible
   execution contract. Prefer recording the planning gap through proposals or by
   tightening the todo boundary to what is actually feasible.
10. Prefer incremental canonical updates when the current todo set is salvageable.
11. Do not borrow executor completion heuristics into todo decomposition.

## Final check

Before you finish, confirm that:

- every in-scope requirement still has active coverage
- the Executor can choose a next todo without redefining the plan
- the Auditor can see where expected evidence should come from
- repeated failures caused a material todo-structure improvement rather than a
  wording-only change
