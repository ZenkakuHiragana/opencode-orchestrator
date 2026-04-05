# Skill: orch-executor-completion-review

Use this skill immediately before claiming non-trivial completion, marking a todo complete after substantive work, or emitting `STEP_AUDIT: ready`.

## Review checklist

- Compare the original request, `north_star`, related requirement ids, changed files, executed commands, produced artifacts, and current todo updates.
- Confirm that the work satisfies the intended requirement rather than only a local sub-problem.
- Confirm that required supporting surfaces such as tests, docs, config, prompts, or artifacts were updated when the requirement implied them.
- Confirm that `STEP_VERIFY` is backed by concrete evidence.
- Confirm that any `audit_ready_when` conditions are actually satisfied.

## Do not declare ready when

- a central requirement remains clearly unsatisfied
- verification evidence is partial or missing
- command results do not support the claim
- an artifact was required but not produced or registered
- todo status would overstate actual completion

## Output consequence

- If the review passes, `STEP_VERIFY: ready` and `STEP_AUDIT: ready` may be appropriate.
- If the review is incomplete, keep `STEP_VERIFY` as `not_ready` or `blocked`, and do not emit `STEP_AUDIT: ready`.
