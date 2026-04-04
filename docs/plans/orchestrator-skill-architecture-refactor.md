# Task Plan: Orchestrator skill architecture refactor

## Context

Refactor the orchestrator so agent prompts keep only core role contracts while
reusable or conditional procedures move into skills. Preserve ownership
boundaries, improve Refiner and Spec-Checker, and wire execution-phase skill
exposure through the plugin/runtime as strongly as the current OpenCode surface
allows.

## Work items

### W-1: Map current agent/runtime responsibilities

- **Phase**: investigate
- **Dependencies**: none
- **Description**: Inspect agent prompts, runtime wiring, command metadata, and
  maintainer docs to identify which instructions are hard invariants, which are
  reusable procedures, and where skill exposure can actually be controlled.
- **Research needed**: Confirm upstream OpenCode skill exposure behavior from
  public source files.
- **Deliverables**: Responsibility map and runtime constraints used to guide the
  refactor.
- **Verification**: Findings are grounded in inspected repo files and upstream
  public source references.

### W-2: Define the target skill topology and runtime control model

- **Phase**: implement
- **Dependencies**: W-1
- **Description**: Add orchestrator-specific skill metadata and a per-agent
  allowlist model, decide which agents get the skill tool, and encode the best
  practical runtime exposure strategy supported by the current plugin/config
  architecture.
- **Research needed**: none beyond W-1.
- **Deliverables**: `src/orchestrator-skills.ts`, package wiring, plugin config
  updates, and skill directory packaging.
- **Verification**: Plugin config resolves packaged skills path, global deny for
  packaged orchestrator skills, and per-agent `permission.skill` allowlists.

### W-3: Rewrite agent prompts to thin core contracts

- **Phase**: implement
- **Dependencies**: W-2
- **Description**: Rewrite affected orchestrator prompts so each prompt keeps
  only role, boundaries, I/O obligations, safety constraints, completion bar,
  and explicit skill-loading expectations where appropriate.
- **Research needed**: none beyond W-1.
- **Deliverables**: Updated prompts for Planner, Refiner, Spec-Checker,
  Todo-Writer, Executor, and consistency touch-up for Auditor.
- **Verification**: Prompt files remain English-only and preserve required
  machine-readable contracts.

### W-4: Add packaged planning/spec/todo skills and align command metadata

- **Phase**: implement
- **Dependencies**: W-2, W-3
- **Description**: Create a small orchestrator-specific skill set for planning,
  refinement, spec-checking, and todo decomposition, and update command
  templates/comments so they describe the new arrangement without duplicating
  old procedural text.
- **Research needed**: none.
- **Deliverables**: `skills/**/SKILL.md`, updated command templates, prompt
  comments.
- **Verification**: Skill descriptions clearly name intended caller and
  discourage cross-phase misuse.

### W-5: Update maintainer-facing docs for the new architecture

- **Phase**: implement
- **Dependencies**: W-3, W-4
- **Description**: Update maintainer docs and README surfaces that describe the
  old oversized-prompt arrangement so they reflect the new thin-core + skill
  model and the runtime exposure limitation.
- **Research needed**: none.
- **Deliverables**: Updated `README.md`, `README.npm.md`, `agent-roles.md`.
- **Verification**: No touched maintainer-facing doc still describes the old
  conflicting arrangement.

### W-6: Add regression tests and run verification

- **Phase**: verify
- **Dependencies**: W-2, W-3, W-4, W-5
- **Description**: Add tests covering skill wiring and packaged-skill exposure,
  then run formatting, targeted tests, and project build.
- **Research needed**: none.
- **Deliverables**: New and updated test files plus command output from format,
  test, and build.
- **Verification**: Targeted tests pass, system prompts remain English-only,
  and TypeScript build succeeds.

## Execution order

1. W-1
2. W-2
3. W-3 and W-4
4. W-5
5. W-6

## Verification checkpoints

- **After W-2**: Packaged skill wiring and per-agent exposure model are encoded
  in runtime metadata with a documented fallback for missing session-level skill
  overrides.
- **After W-4**: Each affected agent prompt is materially smaller and more
  contract-oriented, and each new skill description is phase-specific.
- **Final checkpoint**: Docs, runtime metadata, prompts, and tests all describe
  the same architecture; formatting, targeted tests, and build succeed.

## Open risks

- Current OpenCode/plugin APIs appear to support per-agent skill exposure well,
  but not a clean per-session dynamic skill-name allowlist override; the refactor
  must document this as a fallback rather than pretend it is solved.
