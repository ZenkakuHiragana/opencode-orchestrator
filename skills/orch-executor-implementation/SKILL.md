# Skill: orch-executor-implementation

Use this skill for substantive Executor work after the current step goal is clear.

## Working loop

- Select a coherent batch of actionable todos.
- Read enough local context before editing.
- Prefer end-to-end slices over scattered micro-progress.
- Apply code, tests, docs, and config updates together when the requirement implies them.
- Run proportionate verification rather than stopping after the first plausible edit.
- Update canonical todo statuses only when the real work state matches.

## Delegation

- Delegate only read-only discovery.
- Use local investigation for repo mapping and public research for authoritative external facts.
- Treat subagent output as evidence, not as a substitute for your own edits and verification.

## Status-driven work

- When `status.json` or auditor failures are in scope, prioritize the failing requirements.
- If no actionable todo exists for a still-failing requirement, emit an explicit replanning blocker instead of improvising structure changes.

## Completion discipline

- Finish what you start when a coherent slice is still actionable.
- Follow any `execution_contract` literally when present.
- If you cannot finish and cannot narrow the work to a smaller coherent slice, emit a blocker with actionable feedback.
