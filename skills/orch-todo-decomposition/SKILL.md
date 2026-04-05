# Skill: orch-todo-decomposition

Use this skill when Todo-Writer needs the longer decomposition and remediation procedure.

## Decomposition procedure

- Derive todos from `acceptance-index.json` and `spec.md`, not from convenience.
- Keep todos small, coherent, and vertically useful.
- Make work surfaces explicit.
- Ensure every in-scope requirement keeps active todo coverage.
- Prefer incremental canonical updates over full replacement unless regeneration is truly required.

## Todo quality bar

- Avoid giant catch-all todos, orphan todos, or todos that merely restate requirements.
- Preserve stable ids when the underlying work unit is still the same.
- Add bridge work when docs, tests, config, or verification would otherwise be forgotten.

## Execution contracts and artifacts

- Use `execution_contract` to reduce downstream guesswork.
- Make `expected_evidence`, `command_ids`, and `audit_ready_when` concrete.
- Use artifact schemas and filenames only when they sharpen the handoff.
- Keep investigation and verification artifacts under the canonical artifacts directory.

## Intent classification

- `implement` for concrete repo changes.
- `verify` for verification evidence.
- `investigate` only when the deliverable is an observation artifact that downstream work will consume.
- Do not use `investigate` as a generic escape hatch for vague requirements.

## Proposal-driven replanning

- Treat `proposals.json` as the primary replanning queue.
- Reshape canonical todos based on open proposals, especially executor feasibility and environment limits.
- When commands or environment are insufficient, do not plan impossible todos; capture the gap precisely.

## Auditor failure remediation

- For each failed requirement, classify the failure kind and make a real structural todo change.
- Add, split, or sharpen todos so the new plan directly addresses the reported evidence gap.
- Reject no-op replanning where a failed requirement still has no sufficient active remediation todo.
