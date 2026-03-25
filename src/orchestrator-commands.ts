// Command metadata (frontmatter equivalent) for orchestrator-related commands.
// The long prompt templates live in `commands/*.md` and are loaded by OpenCode
// itself via `{file:...}` when used directly from opencode.json / markdown
// command definitions. Here we only need lightweight metadata for cases where
// the plugin wants to ensure these commands exist.

export interface OrchestratorCommandConfig {
  description: string;
  agent?: string;
  subtask?: boolean;
}

export const orchestratorCommands: Record<string, OrchestratorCommandConfig> = {
  "orch-todo-write": {
    description: "Orchestrator planner step",
    agent: "orch-todo-writer",
    subtask: false,
  },
  "orch-exec": {
    description: "Orchestrator executor step",
    agent: "orch-executor",
    subtask: false,
  },
  "orch-audit": {
    description: "Orchestrator auditor step",
    agent: "orch-auditor",
    // NOTE: subtask: true で auditor を呼ぶと、OpenCode 側の既知の
    // ハングバグ (https://github.com/anomalyco/opencode/issues/11865)
    // に引っかかる可能性がある。そのため、ここでは subtask: false
    // として、メインセッションの通常コマンドとして実行する。
    subtask: false,
  },
  "orch-refine": {
    description: "Orchestrator refiner step",
    agent: "orch-refiner",
    subtask: false,
  },
  "orch-spec-check": {
    description: "Orchestrator spec-checker step",
    agent: "orch-spec-checker",
    subtask: true,
  },
};

export type OrchestratorCommandKey = keyof typeof orchestratorCommands;
