import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { OrchestratorPlugin } from "../src/index.js";

describe("prompt JSON schema placeholders", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ["node", "test.js"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("expands schema placeholders for refiner/spec-checker/planner", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const agents = [
      "orch-refiner",
      "orch-planner",
      "orch-spec-checker",
    ] as const;

    for (const name of agents) {
      const prompt = config.agent[name]?.prompt as string | undefined;
      expect(typeof prompt).toBe("string");
      // Placeholders should have been expanded to real JSON, so they must not
      // appear in the final prompt.
      expect(prompt).not.toContain("$ACCEPTANCE_INDEX_SCHEMA");
      expect(prompt).not.toContain("$COMMAND_POLICY_SCHEMA");
      expect(prompt).not.toContain("$HELPER_COMMANDS_SCHEMA");

      if (name === "orch-refiner" || name === "orch-spec-checker") {
        // Refiner/Spec-Checker should see both acceptance-index and command-policy schemas.
        expect(prompt).toContain("AcceptanceIndex");
        expect(prompt).toContain("CommandPolicy");
        expect(prompt).toContain(
          "same natural language as the current user-facing conversation",
        );
        expect(prompt).toContain("Planner-finalized strict readiness gate");
        expect(prompt).toContain("single machine-readable readiness summary");
        expect(prompt).toContain("Refiner must initialize this field");
        expect(prompt).toContain("Preflight must not overwrite this field");
        expect(prompt).toContain(
          "Planner has consumed current preflight and spec-check results",
        );
        expect(prompt).toContain("available for this task after preflight");
        expect(prompt).toContain("initialize this field to []");
        expect(prompt).toContain("Executor may call these commands directly");
        expect(prompt).not.toContain(
          '"description": "Human-readable notes about how this command should be used (typically in English). Use an empty string when there is no note."',
        );
        // Helper commands JSON should also be present.
        expect(prompt).toContain('"helper_commands"');
        expect(prompt).toContain('"id": "helper:rg"');
        expect(prompt).toContain('"command": "rg"');

        if (name === "orch-spec-checker") {
          expect(prompt).toContain("severity is explanatory only");
          expect(prompt).toContain(
            "machine gating relies on `status`, `feasible_for_loop`, and routed failure metadata",
          );
          expect(prompt).toContain("Machine gating does NOT use `severity`");
          expect(prompt).toContain("supported machine-gate classes");
          expect(prompt).toContain(
            "If any issue with one of those `failure_type` values remains, keep `summary.loop_status` non-ready",
          );
          expect(prompt).toContain("blocking issue's `failure_type`");
          expect(prompt).toContain("`blocking_failure_types`");
          expect(prompt).toContain("blocking issue's `id`");
          expect(prompt).toContain("`blocking_issue_ids`");
        }
      }

      if (name === "orch-planner") {
        // Planner should see command-policy + helper-commands but not acceptance-index schema.
        expect(prompt).not.toContain('"title": "AcceptanceIndex"');
        expect(prompt).toContain('"title": "CommandPolicy"');
        expect(prompt).toContain(
          "same natural language as the current user-facing conversation",
        );
        expect(prompt).toContain("Planner-finalized strict readiness gate");
        expect(prompt).toContain("single machine-readable readiness summary");
        expect(prompt).toContain("Refiner must initialize this field");
        expect(prompt).toContain("Preflight must not overwrite this field");
        expect(prompt).toContain(
          "Planner has consumed current preflight and spec-check results",
        );
        expect(prompt).toContain("available for this task after preflight");
        expect(prompt).toContain("initialize this field to []");
        expect(prompt).toContain("Executor may call these commands directly");
        expect(prompt).not.toContain(
          '"description": "Human-readable notes about how this command should be used (typically in English). Use an empty string when there is no note."',
        );
        expect(prompt).toContain('"helper_commands"');
        expect(prompt).toContain("Planner-finalized strict readiness gate");
        expect(prompt).toContain(
          "base loop-readiness decisions on the spec-checker's top-level `status` and `feasible_for_loop` fields plus routed `failure_type` and `return_to` metadata",
        );
        expect(prompt).toContain(
          "must not treat `severity` as a machine-readable readiness gate",
        );
        expect(prompt).toContain(
          "You may update only these Planner-owned fields in `command-policy.json.summary`",
        );
        expect(prompt).toContain("`summary.loop_status`");
        expect(prompt).toContain("`summary.last_spec_check_status`");
        expect(prompt).toContain("`summary.last_spec_check_feasible_for_loop`");
        expect(prompt).toContain("`summary.blocking_failure_types`");
        expect(prompt).toContain("`summary.blocking_issue_ids`");
        expect(prompt).toContain(
          "You MUST NOT add, remove, or modify `command-policy.json.commands[]`",
        );
        expect(prompt).toContain(
          "You MUST NOT modify preflight-owned helper/availability fields such as `summary.available_helper_commands` or any command `availability` field yourself",
        );
        expect(prompt).toContain("Machine gating does NOT use `severity`");
        expect(prompt).toContain("supported machine-gate classes");
        expect(prompt).toContain("`missing_trace`");
        expect(prompt).toContain("`validation_gap`");
        expect(prompt).toContain("`unauthorized_scope_reduction`");
        expect(prompt).toContain("`acceptance_gap`");
        expect(prompt).toContain("`command_policy_gap`");
        expect(prompt).toContain("`document_runtime_mismatch`");
        expect(prompt).toContain(
          "If any issue with one of those `failure_type` values remains, keep `summary.loop_status` non-ready",
        );
      }
    }
  });

  it("does not leak helper-commands schema JSON into executor prompt", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const prompt = config.agent["orch-executor"]?.prompt as string | undefined;
    expect(typeof prompt).toBe("string");

    // Executor should not see the helper-commands schema JSON itself
    // (resources/helper-commands.json), but it MAY see
    // "available_helper_commands" from the command-policy schema.
    expect(prompt).not.toContain("$HELPER_COMMANDS_SCHEMA");
    expect(prompt).not.toContain('"helper_commands"');
    expect(prompt).not.toContain('"id": "helper:rg"');
    expect(prompt).not.toContain('"command": "rg"');
    expect(prompt).toContain("available_helper_commands");
  });

  it("keeps the planner and refiner aligned on the Discovery Packet contract", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const plannerPrompt = config.agent["orch-planner"]?.prompt as
      | string
      | undefined;
    const refinerPrompt = config.agent["orch-refiner"]?.prompt as
      | string
      | undefined;
    const refineTemplate = config.command["orch-refine"]?.template as
      | string
      | undefined;

    expect(typeof plannerPrompt).toBe("string");
    expect(typeof refinerPrompt).toBe("string");
    expect(typeof refineTemplate).toBe("string");

    const plannerInvariants = [
      "Discovery Packet",
      "discovery-packet.md",
      "updating `discovery-packet.md`",
      "adjusting `proposals.json`",
      "must not hand off to the Refiner while current-task-relevant decisions remain unresolved",
      "Readiness requires a current `command-policy.json` for the story",
      "Once `command-policy.json` exists, treat the required gate sequence as Refiner → Preflight → Spec-Checker",
      "must_exec` commands still matter for whether unavailable commands block loop readiness",
      "required gate sequence as Refiner → Preflight → Spec-Checker",
      "command-policy.json` is required for readiness in all stories",
      "current preflight result is required whenever that file exists",
      "Preflight still runs when the current `command-policy.json` has no `must_exec` commands",
      "refresh helper availability and command availability metadata",
      "Resolved decisions",
      "Explicit non-goals",
      "Validation view",
      "blocking open decisions",
    ];

    for (const invariant of plannerInvariants) {
      expect(plannerPrompt).toContain(invariant);
    }

    expect(plannerPrompt).not.toContain(
      'typically under a section such as "Decisions requiring user confirmation" or similar wording',
    );
    expect(plannerPrompt).not.toContain(
      "required gate sequence as Refiner → Spec-Checker",
    );
    expect(plannerPrompt).not.toContain(
      "skip preflight and proceed directly to `orch-spec-checker`",
    );
    expect(plannerPrompt).not.toContain(
      "preflight was not required because the current `command-policy.json` has no `must_exec` commands",
    );

    const refineInvariants = [
      "approved Discovery Packet",
      "task key",
      "current goal",
      "current artifacts or recent changes",
    ];

    for (const invariant of refineInvariants) {
      expect(refineTemplate).toContain(invariant);
    }

    const refinerInvariants = [
      "discovery-packet.md",
      "Discovery Packet as the contract input produced by Planner",
      "Do **not** reopen, renegotiate, or reinterpret user-approved decisions",
      "unless the packet is contradictory or incomplete in a way that creates a real blocker",
      "same natural language as the current user-facing conversation",
      "commands, file paths, and JSON field names MUST remain ASCII/English",
      "exists and is **aligned with the current acceptance index and spec**",
      "required for every story",
      "including stories whose `commands[]` list is empty or has no `must_exec` entries",
      "initialize `command-policy.json.summary.loop_status` and `summary.available_helper_commands` yourself",
      "set `summary.loop_status` to `needs_refinement`",
      "set `summary.available_helper_commands` to `[]`",
      "Resolved decisions",
      "Explicit non-goals",
      "Validation view",
    ];

    for (const invariant of refinerInvariants) {
      expect(refinerPrompt).toContain(invariant);
    }

    expect(refinerPrompt).not.toContain(
      "spec.md` exists, is written in English",
    );
    expect(refinerPrompt).not.toContain(
      "human-readable (English) specification",
    );
    expect(refinerPrompt).not.toContain(
      "`command-policy.json` (when present) exists",
    );
    expect(refinerPrompt).not.toContain(
      "when the story needs command definitions, a `commands[]` array describing available commands and their metadata",
    );
    expect(refinerPrompt).not.toContain(
      "if command definitions are required but `command-policy.json` is missing",
    );
    expect(refinerPrompt).not.toContain(
      "Write human-readable texts you generate for orchestrator state (for example requirement descriptions, acceptance explanations, contents of `spec.md`, and `usage_notes` in `command-policy.json`) in English.",
    );
    expect(refinerPrompt).not.toContain("only English in orchestrator state");
    expect(refinerPrompt).toContain(
      "Natural-language description of the requirement (written in the same language as the user-facing task unless higher-priority instructions override it).",
    );
  });

  it("keeps planner, refiner, and spec-checker aligned on required Discovery Packet sections", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const plannerPrompt = config.agent["orch-planner"]?.prompt as
      | string
      | undefined;
    const refinerPrompt = config.agent["orch-refiner"]?.prompt as
      | string
      | undefined;
    const checkerPrompt = config.agent["orch-spec-checker"]?.prompt as
      | string
      | undefined;

    expect(typeof plannerPrompt).toBe("string");
    expect(typeof refinerPrompt).toBe("string");
    expect(typeof checkerPrompt).toBe("string");

    const sharedContractSnippets = [
      "Resolved decisions",
      "Explicit non-goals",
      "Validation view",
      "required Discovery Packet sections",
    ];

    for (const snippet of sharedContractSnippets) {
      expect(plannerPrompt).toContain(snippet);
      expect(refinerPrompt).toContain(snippet);
      expect(checkerPrompt).toContain(snippet);
    }
  });

  it("keeps the spec-checker prompt and command aligned on routed failure reporting", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const checkerPrompt = config.agent["orch-spec-checker"]?.prompt as
      | string
      | undefined;
    const specCheckTemplate = config.command["orch-spec-check"]?.template as
      | string
      | undefined;

    expect(typeof checkerPrompt).toBe("string");
    expect(typeof specCheckTemplate).toBe("string");

    const checkerInvariants = [
      "discovery-packet.md",
      "failure_type",
      "return_to",
      "missing_trace",
      "validation_gap",
      "unauthorized_scope_reduction",
      "route the issue back to Planner or Refiner",
      "severity is explanatory only",
      "machine gating relies on `status`, `feasible_for_loop`, and routed failure metadata",
    ];

    for (const invariant of checkerInvariants) {
      expect(checkerPrompt).toContain(invariant);
    }

    const templateInvariants = [
      "routed failure types",
      "failure_type",
      "return_to",
      "missing_trace",
      "validation_gap",
    ];

    for (const invariant of templateInvariants) {
      expect(specCheckTemplate).toContain(invariant);
    }
  });

  it("keeps strict readiness wording aligned across planner, spec-checker, and command-policy schema", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const plannerPrompt = config.agent["orch-planner"]?.prompt as
      | string
      | undefined;
    const refinerPrompt = config.agent["orch-refiner"]?.prompt as
      | string
      | undefined;
    const checkerPrompt = config.agent["orch-spec-checker"]?.prompt as
      | string
      | undefined;

    expect(typeof plannerPrompt).toBe("string");
    expect(typeof checkerPrompt).toBe("string");

    expect(plannerPrompt).toContain(
      "base loop-readiness decisions on the spec-checker's top-level `status` and `feasible_for_loop` fields plus routed `failure_type` and `return_to` metadata",
    );
    expect(plannerPrompt).toContain(
      "must not treat `severity` as a machine-readable readiness gate",
    );
    expect(plannerPrompt).toContain(
      "You may update only these Planner-owned fields in `command-policy.json.summary`",
    );
    expect(plannerPrompt).toContain(
      "You MUST NOT add, remove, or modify `command-policy.json.commands[]`",
    );
    expect(plannerPrompt).toContain(
      "You MUST NOT modify preflight-owned helper/availability fields such as `summary.available_helper_commands` or any command `availability` field yourself",
    );
    expect(checkerPrompt).toContain("severity is explanatory only");
    expect(checkerPrompt).toContain(
      "machine gating relies on `status`, `feasible_for_loop`, and routed failure metadata",
    );
    expect(plannerPrompt).toContain(
      "single machine-readable readiness summary",
    );
    expect(plannerPrompt).toContain(
      "Planner has consumed current preflight and spec-check results",
    );
    expect(checkerPrompt).toContain(
      "single machine-readable readiness summary",
    );
    expect(checkerPrompt).toContain(
      "Planner has consumed current preflight and spec-check results",
    );
    expect(plannerPrompt).toContain("last_spec_check_status");
    expect(plannerPrompt).toContain("last_spec_check_feasible_for_loop");
    expect(plannerPrompt).toContain("blocking_failure_types");
    expect(plannerPrompt).toContain("blocking_issue_ids");
    expect(plannerPrompt).toContain("supported machine-gate classes");
    expect(plannerPrompt).toContain("Machine gating does NOT use `severity`");
    expect(plannerPrompt).toContain(
      "If any issue with one of those `failure_type` values remains, keep `summary.loop_status` non-ready",
    );
    expect(checkerPrompt).toContain("Machine gating does NOT use `severity`");
    expect(checkerPrompt).toContain("supported machine-gate classes");
    expect(checkerPrompt).toContain("`missing_trace`");
    expect(checkerPrompt).toContain("`validation_gap`");
    expect(checkerPrompt).toContain("`unauthorized_scope_reduction`");
    expect(checkerPrompt).toContain("`acceptance_gap`");
    expect(checkerPrompt).toContain("`command_policy_gap`");
    expect(checkerPrompt).toContain("`document_runtime_mismatch`");
  });

  it("keeps loop-status ownership, todo completion-unit wording, and north_star terminology aligned", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const refinerPrompt = config.agent["orch-refiner"]?.prompt as
      | string
      | undefined;
    const plannerPrompt = config.agent["orch-planner"]?.prompt as
      | string
      | undefined;
    const todoWriterPrompt = config.agent["orch-todo-writer"]?.prompt as
      | string
      | undefined;
    const executorPrompt = config.agent["orch-executor"]?.prompt as
      | string
      | undefined;

    expect(typeof refinerPrompt).toBe("string");
    expect(typeof plannerPrompt).toBe("string");
    expect(typeof todoWriterPrompt).toBe("string");
    expect(typeof executorPrompt).toBe("string");

    expect(refinerPrompt).toContain(
      "After that initialization, treat `summary.loop_status` as Planner-owned",
    );
    expect(refinerPrompt).toContain("it does not write `summary.loop_status`");
    expect(plannerPrompt).toContain(
      "It does not write `summary.loop_status`; Planner finalizes that field",
    );
    expect(todoWriterPrompt).toContain("single Executor step");
    expect(todoWriterPrompt).toContain(
      "If no such metadata is attached for this pass",
    );
    expect(executorPrompt).toContain(
      "completion unit that should normally finish within one Executor step",
    );
    expect(executorPrompt).toContain(
      "When no explicit command catalog or id mapping is attached for this pass",
    );
    expect(executorPrompt).toContain(
      "The strict command-catalog rules below apply only when an explicit command catalog is actually supplied for this pass.",
    );
    expect(executorPrompt).not.toContain(
      "If not supplied, you can use any commands.",
    );
    expect(executorPrompt).toContain(
      "that slice itself still satisfies the canonical todo's full completion boundary",
    );
    expect(executorPrompt).toContain(
      "When emitting `STEP_BLOCKER: ... env_blocked`, do **not** mark the blocked todo `completed`.",
    );
    expect(executorPrompt).toContain(
      "do not use repeated self-slicing as a substitute for replanning",
    );
    expect(executorPrompt).toContain("`north_star` section in `spec.md`");
    expect(executorPrompt).not.toContain("`north_star` field in `spec.md`");
  });

  it("keeps execution-phase prompts aligned on observable branching and safe defaults", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const executorPrompt = config.agent["orch-executor"]?.prompt as
      | string
      | undefined;
    const todoWriterPrompt = config.agent["orch-todo-writer"]?.prompt as
      | string
      | undefined;
    const auditorPrompt = config.agent["orch-auditor"]?.prompt as
      | string
      | undefined;
    const execTemplate = config.command["orch-exec"]?.template as
      | string
      | undefined;

    expect(typeof executorPrompt).toBe("string");
    expect(typeof todoWriterPrompt).toBe("string");
    expect(typeof auditorPrompt).toBe("string");
    expect(typeof execTemplate).toBe("string");

    expect(executorPrompt).toContain(
      "Treat a todo as **actionable in the current step** only when the currently visible inputs establish",
    );
    expect(executorPrompt).toContain(
      "Treat multiple todos as a safe same-shaped set only when the visible todo fields show the same intent class",
    );
    expect(executorPrompt).toContain(
      "Choose verification commands using this order of evidence",
    );
    expect(executorPrompt).toContain(
      "If no allowed command can yet be justified as trustworthy evidence for the touched requirement",
    );
    expect(executorPrompt).toContain(
      "Use `not_ready` when the evidence path is still incomplete but could plausibly be completed within the current plan and environment.",
    );
    expect(executorPrompt).toContain(
      "Use `blocked` when the missing evidence path cannot be completed from the currently visible plan, permissions, or environment",
    );
    expect(executorPrompt).toContain(
      "Treat a blocker as `clearly environmental` only when the visible command catalog, tool permissions, or command results show",
    );

    expect(todoWriterPrompt).toContain(
      "Only branch on inputs that are already visible in the current planning pass",
    );
    expect(todoWriterPrompt).toContain(
      "one active todo already has a single main work",
    );
    expect(todoWriterPrompt).toContain(
      "existing implementation or investigation todo is already scoped",
    );
    expect(todoWriterPrompt).toContain("Split the existing todo");
    expect(todoWriterPrompt).toContain(
      "Treat a replanning pass as `no-op` whenever the observable todo structure",
    );
    expect(todoWriterPrompt).toContain(
      "same story revision` means the mapping is supported by the current attached todo state",
    );
    expect(todoWriterPrompt).toContain(
      "Use `## Notes` when the limitation is only an operator-facing caveat",
    );

    expect(auditorPrompt).toContain(
      "Treat a test, diff, log, or artifact as `relevant` only when the visible evidence names or",
    );
    expect(auditorPrompt).toContain(
      "A requirement may pass only when the anchor quality is direct enough",
    );
    expect(auditorPrompt).toContain(
      "Do not infer reasonable effort from summaries alone.",
    );

    expect(execTemplate).toContain(
      "select only todos whose actionability is established by visible todo fields",
    );
    expect(execTemplate).toContain(
      "if actionability or the evidence path is not established, emit an explicit",
    );
    expect(execTemplate).toContain(
      "if no explicit command-id mapping is supplied for this run, rely only on",
    );
    expect(execTemplate).toContain(
      "Return only the required Executor `STEP_*` lines",
    );
    expect(execTemplate).not.toContain(
      "do your tasks, remember your output format.",
    );
  });

  it("keeps implicit requirement coverage wording aligned between planner and spec-checker", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const plannerPrompt = config.agent["orch-planner"]?.prompt as
      | string
      | undefined;
    const refinerPrompt = config.agent["orch-refiner"]?.prompt as
      | string
      | undefined;
    const checkerPrompt = config.agent["orch-spec-checker"]?.prompt as
      | string
      | undefined;

    expect(typeof plannerPrompt).toBe("string");
    expect(typeof checkerPrompt).toBe("string");

    expect(plannerPrompt).toContain(
      "Section E (`implicit_requirement_coverage`) is not optional once the current spec/content implies those obligations",
    );
    expect(plannerPrompt).not.toContain("live_surface_consistency");
    expect(checkerPrompt).toContain("Implicit Requirement Coverage");
    expect(checkerPrompt).toContain(
      "explicit requirement or an explicit non-goal",
    );
    expect(checkerPrompt).toContain("implicit requirements");
    expect(refinerPrompt).toContain("unambiguous");
    expect(refinerPrompt).toContain("traceable");
    expect(refinerPrompt).toContain("verifiable");
    expect(refinerPrompt).toContain(
      "Do not use a bare state phrase like `requirements are not settled` as a trigger",
    );
    expect(refinerPrompt).toContain("Discovery Packet contradictions");
    expect(refinerPrompt).toContain(
      "Treat labels like `blocking open decision`, `blocker`, and `undetermined` as classification results",
    );
    expect(refinerPrompt).toContain(
      "Treat the packet as ready to normalize only when those sections are present",
    );
    expect(refinerPrompt).toContain(
      "Do not call Public Researcher only because external research might improve quality",
    );
    expect(plannerPrompt).toContain(
      "Only branch on conditions that are directly visible at the point of judgment",
    );
    expect(plannerPrompt).toContain(
      "Do not treat file presence, hidden state, or a generic phrase like `continue the previous work` as sufficient proof",
    );
    expect(plannerPrompt).toContain(
      "If task identity is still ambiguous after that check, ask exactly one high-leverage question",
    );
    expect(plannerPrompt).toContain(
      "If the current conversation provides no candidate beyond a generic continuation phrase",
    );
    expect(plannerPrompt).toContain(
      "If any answer is not a clear yes, do not declare the loop ready yet",
    );
    expect(plannerPrompt).toContain(
      "Treat adjectives such as `reasonable`, `clear enough`, `weak`, `high-severity`, or `good state` as descriptions of evidence",
    );
    expect(plannerPrompt).toContain(
      "Do not use words like `reasonably complete` or `good state` as the threshold here",
    );
    expect(plannerPrompt).toContain(
      "Only then may you scan matching existing artifacts and prior proposals to infer context",
    );
    expect(plannerPrompt).toContain(
      "then resume the normal gate sequence `preflight-cli → orch-spec-checker` once the required files exist again",
    );
    expect(plannerPrompt).toContain(
      "This does not authorize guessing the task identity, selecting among multiple task artifacts, or changing accepted scope",
    );
    expect(checkerPrompt).toContain("unambiguous");
    expect(checkerPrompt).toContain("complete");
    expect(checkerPrompt).toContain("consistent");
    expect(checkerPrompt).toContain("traceable");
    expect(checkerPrompt).toContain("verifiable");
    expect(checkerPrompt).toContain(
      'Do not use a phrase like `reasonably complete` as the threshold for `status: "ok"`',
    );
  });

  it("keeps auditor, local-investigator, public-researcher, and todo-write command wording aligned with current roles", async () => {
    const plugin = await OrchestratorPlugin({ client: {} } as any);
    const config: any = {};
    await plugin.config!(config);

    const auditorPrompt = config.agent["orch-auditor"]?.prompt as
      | string
      | undefined;
    const localPrompt = config.agent["orch-local-investigator"]?.prompt as
      | string
      | undefined;
    const publicPrompt = config.agent["orch-public-researcher"]?.prompt as
      | string
      | undefined;
    const todoTemplate = config.command["orch-todo-write"]?.template as
      | string
      | undefined;

    expect(typeof auditorPrompt).toBe("string");
    expect(typeof localPrompt).toBe("string");
    expect(typeof publicPrompt).toBe("string");
    expect(typeof todoTemplate).toBe("string");

    expect(auditorPrompt).toContain(
      "Prefer the dedicated `read`, `glob`, and `grep` tools",
    );
    expect(auditorPrompt).toContain("remote-refresh (`git fetch`)");
    expect(auditorPrompt).toContain("filesystem creation (`mkdir`)");
    expect(auditorPrompt).toContain(
      "If `acceptance-index.json` is malformed but still contains some safely parseable requirement",
    );
    expect(auditorPrompt).not.toContain("`cat`, `rg`, `jq`");

    expect(localPrompt).toContain(
      "Access to read-only repository tools (`glob`, `grep`, `read`, `lsp`, `list`)",
    );
    expect(localPrompt).toContain(
      "Contains only factual statements supported by evidence from the local repository.",
    );
    expect(localPrompt).toContain(
      "Do NOT use `bash`, `edit`, `write`, `patch`, `task`, `skill`, or any external search tool.",
    );
    expect(localPrompt).toContain(
      "Follow any higher-priority language instruction from system or developer messages.",
    );
    expect(localPrompt).not.toContain("codesearch");

    expect(publicPrompt).toContain(
      "Do **not** assume an interactive clarification round will occur",
    );
    expect(publicPrompt).toContain("concrete external evidence need");
    expect(publicPrompt).toContain(
      "A concrete external evidence need means one or more of",
    );
    expect(publicPrompt).toContain(
      "Treat `concrete` as shorthand for one of those listed evidence classes",
    );
    expect(publicPrompt).toContain(
      "If no concrete external evidence need is present at this stage, do **not** start external search just because research might improve quality",
    );
    expect(publicPrompt).toContain(
      "If helpful, you may say that a repository-local investigation would be the safer next route",
    );
    expect(publicPrompt).toContain(
      "reliable research cannot proceed until those public facts are supplied",
    );
    expect(publicPrompt).toContain(
      "name the kind of public equivalent that would be needed, and stop rather than guessing",
    );
    expect(publicPrompt).toContain(
      "Report missing public-safe inputs as part of your result instead of assuming an interactive clarification round",
    );
    expect(publicPrompt).toContain(
      "Do not add conversational niceties. Start directly with either the visible Phase 0 block",
    );
    expect(publicPrompt).toContain(
      "For every **substantive factual or procedural claim**, provide a clear citation.",
    );
    expect(publicPrompt).toContain(
      "Use the **full structured block** unless **all** of the following are true",
    );
    expect(publicPrompt).toContain(
      "Do **not** fabricate citations or pretend that an external source was consulted.",
    );
    expect(publicPrompt).toContain(
      "Follow any higher-priority language instruction from system or developer messages.",
    );

    expect(todoTemplate).toContain(
      "Prefer incremental replanning over full regeneration",
    );
    expect(todoTemplate).toContain(
      "add new todos when only new work is needed",
    );
    expect(todoTemplate).toContain(
      "replace the full canonical set only when the todo cache is missing, invalid, or unsalvageable",
    );
  });
});
