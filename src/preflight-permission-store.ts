export type BashPermissionDecision = "allow" | "ask" | "deny";

export type PreflightRunnerBashPermissionSource = {
  globalBash: unknown;
  agentBash: unknown;
};

let _preflightRunnerBashPermissionSource: PreflightRunnerBashPermissionSource =
  {
    globalBash: undefined,
    agentBash: undefined,
  };

export function setPreflightRunnerBashPermissionSource(input: {
  globalBash: unknown;
  agentBash: unknown;
}): void {
  _preflightRunnerBashPermissionSource = {
    globalBash: input.globalBash,
    agentBash: input.agentBash,
  };
}

export function getPreflightRunnerBashPermissionSource(): PreflightRunnerBashPermissionSource {
  return _preflightRunnerBashPermissionSource;
}
