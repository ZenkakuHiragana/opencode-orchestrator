Execute the current step using the attached acceptance artifacts, canonical todos,
and execution metadata for this run as the source of truth.

Before acting:

- select only todos whose actionability is established by visible todo fields,
  linked requirements, and any attached execution contract,
- if actionability or the evidence path is not established, emit an explicit
  `STEP_BLOCKER` instead of guessing.

Return only the required Executor `STEP_*` lines in the exact format and order
defined by the Executor prompt.

$ARGUMENTS
