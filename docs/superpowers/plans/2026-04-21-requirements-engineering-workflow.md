# Requirements-Engineering Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the planning pipeline so Planner owns discovery, Refiner normalizes approved discovery into canonical state, and Spec-Checker reports routed failures while Planner persists a strict readiness gate in `command-policy.json.summary`.

**Architecture:** Keep `command-policy.json` as the single source of truth for loop startability, but separate responsibilities more cleanly: Refiner owns command definitions, Preflight refreshes mechanical availability only, and Planner finalizes strict readiness after combining preflight, spec-check, and open proposal state. Keep `severity` as human-facing explanation only; machine gating must use `status`, `feasible_for_loop`, and routed `failure_type` data.

**Tech Stack:** TypeScript, Vitest, Markdown agent prompts, JSON schema resources, repository documentation

---

> Repository policy note: this plan intentionally omits git commit steps because this repository forbids agent-created commits unless the user explicitly requests them.

### Task 1: Redefine `command-policy` summary as the strict planning gate

**Files:**

- Modify: `resources/command-policy.json`
- Modify: `agents/orch-planner.md`
- Modify: `agents/orch-spec-checker.md`
- Test: `tests/prompt-schema-placeholders.test.ts`

- [ ] **Step 1: Add failing prompt/schema expectations for the new gate semantics**

Extend `tests/prompt-schema-placeholders.test.ts` with expectations that capture the new contract.

```ts
expect(plannerPrompt).toContain(
  "status` / `feasible_for_loop` / routed `failure_type`",
);
expect(plannerPrompt).toContain(
  "must not treat `severity` as the machine-readable readiness gate",
);
expect(checkerPrompt).toContain("severity is explanatory only");
expect(checkerPrompt).toContain(
  "machine gating should rely on `status`, `feasible_for_loop`, and routed failure fields",
);
expect(commandPolicySchema).toContain(
  "strict readiness gate finalized by Planner after preflight and spec-check",
);
```

- [ ] **Step 2: Run the prompt/schema test to verify it fails**

Run:

```bash
npm test -- tests/prompt-schema-placeholders.test.ts
```

Expected: FAIL because the current prompts still talk about high-severity issues as the readiness stop condition and the schema still describes `loop_status` as a purely mechanical gate.

- [ ] **Step 3: Update the `command-policy` schema descriptions**

Rewrite the summary field descriptions in `resources/command-policy.json` so the runtime contract is explicit.

```json
"loop_status": {
  "description": "Strict readiness gate for starting the executor loop. Refiner initializes this field to 'needs_refinement'; Planner finalizes it after combining current preflight results, spec-check results, and unresolved planning blockers. Preflight alone must not promote it to 'ready_for_loop'."
}
```

Also extend `summary` with planner-owned spec-check rollup fields that the loop gate may inspect without reading any other file.

```json
"last_spec_check_status": {
  "type": ["string", "null"],
  "description": "Most recent top-level status returned by Spec-Checker for the current command-policy revision."
},
"last_spec_check_feasible_for_loop": {
  "type": ["boolean", "null"],
  "description": "Most recent feasible_for_loop value returned by Spec-Checker for the current command-policy revision."
},
"blocking_failure_types": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Machine-readable blocking failure_type values from the latest spec-check result that still prevent loop start."
},
"blocking_issue_ids": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Issue IDs from the latest spec-check result that still block loop start."
}
```

- [ ] **Step 4: Rewrite Planner readiness guidance**

Edit `agents/orch-planner.md` so it no longer uses high-severity issues as the canonical stop condition.

```md
- Treat `command-policy.json.summary.loop_status` as the strict readiness gate that you finalize after the current Refiner → Preflight → Spec-Checker cycle.
- Use Spec-Checker top-level fields (`status`, `feasible_for_loop`) and routed issue metadata (`failure_type`, `return_to`) as the machine-readable basis for readiness.
- `severity` may help you explain or order issues for the human, but you MUST NOT treat `severity` as the machine-readable readiness gate.
```

- [ ] **Step 5: Rewrite Spec-Checker output semantics**

Edit `agents/orch-spec-checker.md` so `severity` is explicitly explanatory only.

```md
- `severity` is for human-facing prioritization only.
- Machine gating should rely on top-level `status`, `feasible_for_loop`, and routed failure metadata such as `failure_type`, `return_to`, `missing_trace`, and `validation_gap`.
- If you believe loop start should remain blocked, reflect that through `status`, `feasible_for_loop`, and the routed issue fields, not through `severity` alone.
```

- [ ] **Step 6: Re-run the prompt/schema test**

Run:

```bash
npm test -- tests/prompt-schema-placeholders.test.ts
```

Expected: PASS.

### Task 2: Make Preflight mechanical-only and move final readiness to Planner

**Files:**

- Modify: `src/preflight-cli.ts`
- Test: `tests/preflight-permission-shortcircuit.test.ts`

- [ ] **Step 1: Add a failing preflight test for non-promotion to `ready_for_loop`**

Extend `tests/preflight-permission-shortcircuit.test.ts` with a case showing that preflight should refresh availability but must not promote an initialized policy to `ready_for_loop` on its own.

```ts
it("does not promote loop_status to ready_for_loop without planner finalization", async () => {
  prepareState(task, true);
  // seed command-policy summary.loop_status = needs_refinement
  // run preflight with an available must_exec command
  // expect availability to become available
  // expect summary.loop_status to remain needs_refinement
});
```

- [ ] **Step 2: Run the targeted preflight test to verify it fails**

Run:

```bash
npm test -- tests/preflight-permission-shortcircuit.test.ts
```

Expected: FAIL because preflight currently upgrades `loop_status` directly to `ready_for_loop`.

- [ ] **Step 3: Change `preflight-cli` to refresh mechanical fields only**

Edit `src/preflight-cli.ts` so it still updates:

```ts
policyJson.summary.available_helper_commands = availableHelperCommands;
cmd.availability = r.available ? "available" : "unavailable";
```

but changes `loop_status` only in downward-safe ways:

```ts
if (mustExecUnavailable) {
  policyJson.summary.loop_status = hasSpecError
    ? "needs_refinement"
    : "blocked_by_environment";
}
```

and otherwise preserves the existing non-ready state instead of promoting to `ready_for_loop`.

- [ ] **Step 4: Re-run the targeted preflight test**

Run:

```bash
npm test -- tests/preflight-permission-shortcircuit.test.ts
```

Expected: PASS.

### Task 3: Tighten the runtime loop gate around planner-finalized summary fields

**Files:**

- Modify: `src/orchestrator-loop.ts`
- Test: `tests/cli-run-resume-messages.test.ts`
- Test: `tests/orchestrator-fix.test.ts`

- [ ] **Step 1: Add a failing loop-gate test for missing planner-finalized spec-check summary**

Add a test near existing command-policy gate coverage showing that `ready_for_loop` is rejected when the planner-finalized spec-check summary is absent or contradictory.

```ts
it("does not start the loop when ready_for_loop lacks planner-finalized spec-check summary", async () => {
  // write command-policy.json with loop_status=ready_for_loop but
  // last_spec_check_status=null and last_spec_check_feasible_for_loop=null
  // expect command entrypoint to fail with a planning-gate message
});
```

- [ ] **Step 2: Run the targeted loop/fix tests to verify they fail**

Run:

```bash
npm test -- tests/cli-run-resume-messages.test.ts tests/orchestrator-fix.test.ts
```

Expected: FAIL because the current runtime gate only checks `loop_status` and command availability.

- [ ] **Step 3: Extend `orchestrator-loop.ts` parsing and validation**

Parse the new planner-finalized summary fields from `command-policy.json`.

```ts
summary?: {
  loop_status?: string;
  available_helper_commands?: string[];
  last_spec_check_status?: string | null;
  last_spec_check_feasible_for_loop?: boolean | null;
  blocking_failure_types?: string[];
  blocking_issue_ids?: string[];
};
```

Then add strict checks before allowing `ready_for_loop`:

```ts
if (status === "ready_for_loop") {
  const specOk = lastSpecCheckStatus === "ok";
  const feasible = lastSpecCheckFeasibleForLoop === true;
  const noBlockingFailures = blockingFailureTypes.length === 0;
  const noBlockingIssues = blockingIssueIds.length === 0;
  if (specOk && feasible && noBlockingFailures && noBlockingIssues) {
    return;
  }
  console.error(
    "[opencode-orchestrator] ERROR: command-policy.json.summary.loop_status=ready_for_loop ですが、Planner が保存した spec-check gate 情報が不足または矛盾しています。",
  );
  process.exit(1);
}
```

- [ ] **Step 4: Re-run the targeted loop/fix tests**

Run:

```bash
npm test -- tests/cli-run-resume-messages.test.ts tests/orchestrator-fix.test.ts
```

Expected: PASS.

### Task 4: Align Planner role boundaries and persistence responsibilities

**Files:**

- Modify: `src/orchestrator-agents.ts`
- Modify: `AGENTS.md`
- Modify: `agent-roles.md`
- Modify: `README.md`
- Test: `tests/orchestrator-agents.test.ts`

- [ ] **Step 1: Add a failing permission/ownership test for planner finalizing `command-policy.json`**

Extend `tests/orchestrator-agents.test.ts` with an expectation that Planner may update planner-owned summary metadata in `command-policy.json` while still not owning `commands[]`.

```ts
it("orch-planner may update planner-owned command-policy summary metadata", () => {
  const write = orchestratorAgents["orch-planner"].permission.write;
  expect(write).toEqual(
    expect.objectContaining({
      "$XDG_STATE_HOME/opencode/orchestrator/*/state/command-policy.json":
        "allow",
    }),
  );
});
```

- [ ] **Step 2: Run the targeted ownership test to verify it fails**

Run:

```bash
npm test -- tests/orchestrator-agents.test.ts
```

Expected: FAIL because Planner currently cannot write `command-policy.json`.

- [ ] **Step 3: Allow planner writes to planner-owned summary metadata surfaces**

Update `src/orchestrator-agents.ts` so Planner may write `command-policy.json` in addition to `discovery-packet.md`, `proposals.json`, and `status.json`.

```ts
write: {
  "*": "deny",
  "$XDG_STATE_HOME/opencode/orchestrator/*/state/status.json": "allow",
  "$XDG_STATE_HOME/opencode/orchestrator/*/state/discovery-packet.md": "allow",
  "$XDG_STATE_HOME/opencode/orchestrator/*/state/proposals.json": "allow",
  "$XDG_STATE_HOME/opencode/orchestrator/*/state/command-policy.json": "allow",
},
```

- [ ] **Step 4: Rewrite ownership docs**

Update the touched docs so they all say the same thing:

```md
- Refiner owns `command-policy.json.commands[]`.
- Preflight refreshes `commands[].availability` and `summary.available_helper_commands`.
- Planner finalizes strict readiness in `command-policy.json.summary`, including the final `loop_status` and spec-check rollup fields.
- `status.json` remains an executor/auditor progress snapshot, not the planning gate source of truth.
```

- [ ] **Step 5: Re-run the targeted ownership test**

Run:

```bash
npm test -- tests/orchestrator-agents.test.ts
```

Expected: PASS.

### Task 5: Update Discovery Packet docs and planning docs to match the shared contract

**Files:**

- Modify: `docs/superpowers/specs/2026-04-21-requirements-engineering-workflow-design.md`
- Modify: `docs/superpowers/plans/2026-04-21-requirements-engineering-workflow.md`
- Modify: `README.md`
- Modify: `agent-roles.md`

- [ ] **Step 1: Replace stale Discovery Packet “required items” wording in the implementation plan**

Update this plan so it states clearly that the richer Planner-side packet structure is optional discovery scaffolding, not the shared cross-agent required contract.

```md
- Shared Discovery Packet contract: `Resolved decisions`, `Explicit non-goals`, `Validation view`.
- Additional packet sections remain Planner-side discovery aids rather than cross-agent required keys.
```

- [ ] **Step 2: Align README and role docs with the strict gate model**

Update the user-facing docs so they describe:

```md
- `command-policy.json.summary.loop_status` is the strict readiness gate.
- Preflight does not finalize readiness by itself.
- Spec-Checker `severity` is explanatory; machine gating uses `status`, `feasible_for_loop`, and routed failures.
```

- [ ] **Step 3: Re-read the touched docs for contradictions**

Check that the touched files all agree on:

```text
Planner owns discovery + final readiness summary
Refiner owns canonical requirements and command definitions
Preflight owns mechanical availability refresh only
Spec-Checker severity is explanatory only; machine gating uses status, feasible_for_loop, and routed failures
status.json is not the planning gate source of truth
```

### Task 6: Verify the whole change set

**Files:**

- Test: `tests/preflight-permission-shortcircuit.test.ts`
- Test: `tests/orchestrator-agents.test.ts`
- Test: `tests/cli-run-resume-messages.test.ts`
- Test: `tests/orchestrator-fix.test.ts`
- Test: `tests/prompt-schema-placeholders.test.ts`
- Test: `tests/plugin.test.ts`
- Test: `tests/systemPrompts-noJapanese.test.ts`
- Build check: repository root

- [ ] **Step 1: Format before broader verification**

Run:

```bash
npm run format
```

Expected: changed `.ts`, `.json`, and `.md` files are rewritten or reported unchanged with no errors.

- [ ] **Step 2: Run the focused regression suite**

Run:

```bash
npm test -- tests/preflight-permission-shortcircuit.test.ts tests/orchestrator-agents.test.ts tests/cli-run-resume-messages.test.ts tests/orchestrator-fix.test.ts tests/prompt-schema-placeholders.test.ts tests/plugin.test.ts tests/systemPrompts-noJapanese.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run the TypeScript build**

Run:

```bash
npm run build
```

Expected: PASS.

## Self-review checklist

- Spec coverage:
  - Task 1 covers the new strict readiness semantics and the removal of `severity` from machine gating.
  - Task 2 keeps Preflight mechanical-only and prevents it from promoting `ready_for_loop` by itself.
  - Task 3 makes runtime loop gating depend on planner-finalized summary metadata inside `command-policy.json`.
  - Task 4 aligns write permissions and ownership docs with Planner finalizing summary metadata but not `commands[]`.
  - Task 5 aligns Discovery Packet docs and top-level docs with the new shared contract and strict gate semantics.
  - Task 6 covers formatting, targeted regressions, full tests, and build verification.
- Placeholder scan: no `TODO`, `TBD`, or “similar to above” shortcuts remain.
- Type consistency: summary field names stay consistent across schema, prompts, runtime parsing, and tests: `loop_status`, `available_helper_commands`, `last_spec_check_status`, `last_spec_check_feasible_for_loop`, `blocking_failure_types`, and `blocking_issue_ids`.
