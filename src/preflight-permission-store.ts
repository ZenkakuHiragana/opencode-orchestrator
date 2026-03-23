export type BashPermissionDecision = "allow" | "ask" | "deny";

let _preflightRunnerBashPermission: unknown = undefined;

export function setPreflightRunnerBashPermission(permission: unknown): void {
  _preflightRunnerBashPermission = permission;
}

export function getPreflightRunnerBashPermission(): unknown {
  return _preflightRunnerBashPermission;
}
