// For todo-writer/executor/auditor, the true behavior and role instructions live in
// agents/*.md as system prompts. Here we keep per-step "user" prompts as thin
// as possible to avoid poisoning the conversation history with redundant role
// descriptions. Todo-Writer does not need any extra per-step text beyond the
// attached files and its system prompt, so we return an empty string.
export function buildTodoWriterPrompt(): string {
  return "";
}

export function buildExecutorPrompt(shouldEmphasizeAuditRead: boolean): string {
  // The executor normally relies solely on its system prompt and attached
  // state files (acceptance-index.json, todo.json, status.json, etc.).
  // In the rare case immediately after an auditor run, the orchestrator may
  // set shouldEmphasizeAuditRead=true to explicitly remind the executor to
  // read the latest auditor result from status.json.
  if (!shouldEmphasizeAuditRead) {
    return "";
  }

  return (
    "The previous loop step executed the external Auditor for this task. " +
    "In this step you MUST read the latest auditor result from the `status.json`."
  );
}

export function buildAuditPrompt(
  originalPrompt: string,
  taskName: string,
): string {
  return (
    "You are a strict external auditor for an orchestrated development loop.\n\n" +
    "The original high-level goal for this run was:\n---\n" +
    originalPrompt +
    "\n---\n\n" +
    "Decide whether the current story is fully completed according to its acceptance criteria and project gates (build/test/lint/docs).\n" +
    "Respond ONLY with a single JSON object on one line with the following shape:\n" +
    '{\n  "done": true | false,\n  "requirements": [ { "id": "R1-some-requirement", "passed": true | false } ]\n}\n' +
    "If you are not certain that a requirement is fully satisfied, set its passed field to false.\n" +
    `This run is tracked under task: ${taskName}.`
  );
}

export function buildCommitPrompt(): string {
  return (
    "Create git commits for the changes made in this story, grouping related changes into coherent commits. " +
    "Use the `autocommit` tool instead of calling `git commit` directly via bash. " +
    "Only commit changes that are appropriate for this task, and avoid committing build artifacts or secrets. " +
    "If no commit is needed, explain why."
  );
}
