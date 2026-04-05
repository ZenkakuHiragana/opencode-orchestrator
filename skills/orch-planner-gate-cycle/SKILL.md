# Skill: orch-planner-gate-cycle

Use this skill for planning passes that need the full Refiner / Preflight / Spec-Checker gate cycle.

## Task key discipline

- Derive one canonical task key in lowercase kebab-case and reuse it consistently for state paths, tool arguments, and summaries.
- Do not silently switch task keys mid-pass.

## Gate cycle

- Treat missing gates as the next action, not as a permanent blocker.
- When the current command-policy defines any `must_exec` command, the required sequence for the current requirement/command set is:
  1. Refiner
  2. Preflight
  3. Spec-Checker
- When no `must_exec` command is defined, the required sequence is:
  1. Refiner
  2. Spec-Checker
- If requirements or command definitions changed, rerun the affected gates before declaring readiness or infeasibility.

## Preflight procedure

- Use only Refiner-defined commands from `command-policy.json.commands[]`.
- Never invent command ids or new command entries in Planner.
- If a command has `probe_command`, use it for probing; otherwise use `command`.
- Never pass raw `{{placeholder}}` templates to preflight. Instantiate safe concrete probe values first.
- Pass the canonical task key to `preflight-cli`.
- After preflight, re-read `command-policy.json` and base readiness decisions on the updated availability and helper summary.

## Spec-check follow-up

- Treat Spec-Checker as a quality gate, not as a rubber stamp.
- Re-enter refinement when issues would force Todo-Writer, Executor, or Auditor to guess.
- Prioritize structural blockers over wording polish.

## Open decisions

- Scan `spec.md` for open decisions.
- Classify each as either loop-blocking or deferrable.
- Resolve loop-blocking decisions in the current pass or list them explicitly as gating items.
- Do not hide loop-blocking decisions behind vague “next steps” wording.

## Proposal and env_blocked triage

- Read `status.json` and `proposals.json` when prior loop failures are relevant.
- For `env_blocked` proposals, parse the structured fields in `details` and decide between:
  - preserving the requirement and expanding command definitions via Refiner, or
  - redesigning the requirement/spec to fit the environment.
- Only treat a proposal as cleared when the underlying issue is concretely addressed.
- Do not reset failure counters speculatively.
