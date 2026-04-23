Run the spec & feasibility checker on the current acceptance index, the current
discovery packet, and any attached summaries. Diagnose structural issues,
contradictions, traceability breaks, validation gaps, missing implicit
requirements, and command-policy gaps.

Respond with a single JSON object spec-check report as described in the
spec-checker instructions. The report must use routed failure types and include
issue-level fields such as `failure_type`, `return_to`, `missing_trace`, and
`validation_gap` so Planner can send each issue back to Planner or Refiner.

Spec-checker instructions:
$ARGUMENTS
