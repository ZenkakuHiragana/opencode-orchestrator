Execute the current step using the attached acceptance artifacts, canonical todos,
and execution metadata for this run as the source of truth.

Before acting:

- select only todos whose actionability is established by visible todo fields,
  linked requirements, and any attached execution contract,
- choose verification commands only from the commands explicitly allowed for this
  run, using the narrowest command that directly supports the touched requirement
  when possible,
- if actionability or the evidence path is not established, emit an explicit
  `STEP_BLOCKER` instead of guessing.
- if no explicit command-id mapping is supplied for this run, rely only on
  host-permitted commands justified by visible evidence and use `-` for command-id
  slots in `STEP_CMD` / `STEP_VERIFY` unless the prompt explicitly supplies a
  still-valid mapping for this revision.

Return only the required Executor `STEP_*` lines in the exact format and order
defined by the Executor prompt.

$ARGUMENTS
