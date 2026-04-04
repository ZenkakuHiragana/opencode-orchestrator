---
name: orch-planner-gate-cycle
description: Planner-only gate-cycle procedure for orch-planner. Use this when coordinating refinement, preflight, and spec-checking for executor-loop readiness. Do not use for implementation, todo decomposition, or repository editing.
---

# Orchestrator Planner Gate Cycle

## Purpose

This skill holds the reusable planning procedure for `orch-planner`.

Use it to turn a high-level goal or a revised task state into a decisive next
planning action, a refreshed gate run, or a loop-readiness summary.

## Intended caller

- `orch-planner`

## Not intended for

- `orch-refiner`
- `orch-spec-checker`
- `orch-todo-writer`
- `orch-executor`
- any implementation or repository-editing task

## What this skill is for

- task-key stabilization
- repository/state-first planning passes
- coordinating `orch-refiner`, `preflight-cli`, and `orch-spec-checker`
- triaging `proposals.json` and recent planning failures
- separating true loop blockers from mere incompleteness
- producing a short human-facing readiness summary

## What this skill is not for

- writing canonical acceptance/spec state directly
- defining executor todos
- deciding concrete code changes
- treating a missing gate as a permanent blocker when the gate can still be run

## Procedure

1. Derive or confirm the canonical task key.
2. Read the current task state for that key:
   - `acceptance-index.json`
   - `spec.md`
   - `command-policy.json`
   - `status.json`
   - `proposals.json`
3. Identify which planning phase the task is currently in:
   - refinement needed
   - preflight needed
   - spec-check needed
   - ready or not ready for executor loop
4. Refresh missing or stale gates for the current requirement version:
   - run `orch-refiner` when acceptance/spec/command definitions are missing,
     outdated, or contradicted by the current goal
   - run `preflight-cli` when `must_exec` commands exist and availability has not
     been refreshed for the current command set
   - run `orch-spec-checker` on the current state after the required upstream
     gates have run
5. When `proposals.json` contains open entries, treat them as first-class
   planning inputs rather than optional notes.
6. For `env_blocked` proposals, choose explicitly between:
   - preserving the requirement and expanding command definitions through
     refinement, or
   - refining the requirement/evidence model to fit the environment
7. Distinguish issue classes before summarizing:
   - missing or stale planning state
   - structural spec issues
   - command-availability or environment issues
   - open decisions that would force downstream guessing
   - non-blocking caveats
8. Base executor-loop readiness only on real loop blockers:
   - `command-policy.json.summary.loop_status`
   - `must_exec` availability
   - unresolved high-severity spec issues
   - unresolved loop-blocking open decisions
   - unresolved gating proposals
9. Do not conflate unfinished implementation or unmet acceptance with loop-start
   blockage unless they imply missing or broken planning state.
10. If you need a human decision, ask exactly one high-leverage question and
    make the recommended default explicit.

## Summary discipline

When you report readiness:

- name the exact blocking condition, if any
- separate current state from next action
- keep the reply human-facing and concise
- avoid speaking to downstream agents as if they were the audience

## Final check

Before finishing, confirm that your summary answers all of these:

- What gate ran last?
- What gate must run next, if any?
- Is the loop actually ready to start?
- If not, what exactly blocks it?
