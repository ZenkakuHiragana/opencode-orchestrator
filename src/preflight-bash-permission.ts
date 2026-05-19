export type CommandPermissionDecision = "allow" | "ask" | "deny";

export type PermissionEvaluationResult = {
  decision: CommandPermissionDecision;
  determined: boolean;
  matchedPattern: string | null;
};

type PermissionLayerEvaluation = {
  matched: boolean;
  decision: CommandPermissionDecision;
  matchedPattern: string | null;
};

function isBashPermissionDecision(
  value: unknown,
): value is CommandPermissionDecision {
  return value === "allow" || value === "ask" || value === "deny";
}

function escapeRegexChar(ch: string): string {
  return /[\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
}

function wildcardToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") {
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else {
      out += escapeRegexChar(ch);
    }
  }
  out += "$";
  return new RegExp(out);
}

function wildcardMatch(pattern: string, command: string): boolean {
  return wildcardToRegExp(pattern).test(command);
}

function evaluateBashPermissionLayer(
  command: string,
  permission: unknown,
): PermissionLayerEvaluation {
  const normalizedCommand = command.trim();

  if (permission === undefined) {
    return { matched: false, decision: "ask", matchedPattern: null };
  }

  if (isBashPermissionDecision(permission)) {
    return { matched: true, decision: permission, matchedPattern: null };
  }

  if (
    !permission ||
    typeof permission !== "object" ||
    Array.isArray(permission)
  ) {
    return { matched: false, decision: "ask", matchedPattern: null };
  }

  let lastMatch: {
    decision: CommandPermissionDecision;
    pattern: string;
  } | null = null;

  for (const [pattern, value] of Object.entries(permission)) {
    if (!isBashPermissionDecision(value)) {
      continue;
    }
    if (wildcardMatch(pattern, normalizedCommand)) {
      lastMatch = { decision: value, pattern };
    }
  }

  if (!lastMatch) {
    return { matched: false, decision: "ask", matchedPattern: null };
  }

  return {
    matched: true,
    decision: lastMatch.decision,
    matchedPattern: lastMatch.pattern,
  };
}

export function evaluateBashPermission(
  command: string,
  permission: unknown,
): PermissionEvaluationResult {
  const layer = evaluateBashPermissionLayer(command, permission);
  if (!layer.matched) {
    return { decision: "ask", determined: true, matchedPattern: null };
  }

  return {
    decision: layer.decision,
    determined: true,
    matchedPattern: layer.matchedPattern,
  };
}

export function evaluateEffectiveBashPermission(
  command: string,
  source: { globalBash: unknown; agentBash: unknown },
): PermissionEvaluationResult {
  if (source.globalBash === undefined && source.agentBash === undefined) {
    return { decision: "allow", determined: true, matchedPattern: null };
  }

  const globalLayer = evaluateBashPermissionLayer(command, source.globalBash);
  const agentLayer = evaluateBashPermissionLayer(command, source.agentBash);

  const lastMatch = agentLayer.matched
    ? agentLayer
    : globalLayer.matched
      ? globalLayer
      : null;

  if (!lastMatch) {
    return { decision: "ask", determined: true, matchedPattern: null };
  }

  return {
    decision: lastMatch.decision,
    determined: true,
    matchedPattern: lastMatch.matchedPattern,
  };
}
