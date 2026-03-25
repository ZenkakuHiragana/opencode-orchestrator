import { tool } from "@opencode-ai/plugin/tool";
import * as fs from "node:fs";
import * as path from "node:path";
import helperCommandsData from "../resources/helper-commands.json" with { type: "json" };
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { getOpencodeClient } from "./opencode-client-store.js";
import { getPreflightRunnerBashPermissionSource } from "./preflight-permission-store.js";

type ToastVariant = "info" | "success" | "warning" | "error";

/**
 * Show a toast notification in the OpenCode TUI.
 * Best-effort: failures are silently ignored so that preflight logic
 * is never disrupted by notification issues.
 */
function emitToast(input: {
  title?: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}): void {
  try {
    const client = getOpencodeClient();
    if (!client?.tui?.showToast) return;
    // Fire-and-forget; do not await.
    void client.tui.showToast({
      body: {
        ...(input.title ? { title: input.title } : {}),
        message: input.message,
        variant: input.variant,
        ...(typeof input.duration === "number"
          ? { duration: input.duration }
          : {}),
      },
    });
  } catch {
    // Toast failures must never break preflight behavior.
  }
}

const z = tool.schema;

export type CommandUsage = "must_exec" | "may_exec" | "doc_only";

export type CommandDescriptor = {
  // Stable identifier assigned by the refiner. This ID must be unique
  // per task and remain stable across spec-check, preflight, and
  // command-policy generation so that downstream agents can refer to
  // commands without reconstructing them from free-form text.
  id: string;
  command: string;
  role: string;
  usage: CommandUsage;
};

export function truncateExcerpt(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export type PreflightProbeResult = {
  id: string;
  command: string;
  role: string | null;
  usage: CommandUsage;
  available: boolean;
  exit_code: number | null;
  stderr_excerpt: string;
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

function emitPreflightMetadata(
  context: {
    metadata?: (input: {
      title?: string;
      metadata?: Record<string, unknown>;
    }) => void;
  },
  input: {
    title: string;
    task: string;
    phase: string;
    completed?: number;
    total?: number;
    command?: string;
    commandId?: string;
    attempt?: number;
    status?: string;
  },
): void {
  try {
    context.metadata?.({
      title: input.title,
      metadata: {
        tool: "preflight-cli",
        task: input.task,
        phase: input.phase,
        ...(typeof input.completed === "number"
          ? { completed: input.completed }
          : {}),
        ...(typeof input.total === "number" ? { total: input.total } : {}),
        ...(input.command ? { command: input.command } : {}),
        ...(input.commandId ? { command_id: input.commandId } : {}),
        ...(typeof input.attempt === "number"
          ? { attempt: input.attempt }
          : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
  } catch {
    // Metadata updates are best-effort only.
  }
}

const preflightCliTool = tool({
  description:
    "Helper tool EXCLUSIVE FOR orch-planner agent: evaluate command availability using OpenCode's permission settings and return a per-command JSON result. Do not call this tool from other agents; misuse will return SPEC_ERROR.",
  args: {
    task: z
      .string()
      .describe(
        "Canonical orchestrator task key (lowercase-kebab-case, for example `example-task`). This MUST match an existing task whose acceptance-index.json, spec.md, and command-policy.json already exist. Do not pass free-form sentences or ad-hoc labels; misuse will cause SPEC_ERROR.",
      ),
    commands: z
      .array(
        z.object({
          // Stable identifier assigned by the refiner. Must be unique
          // per task and reused across spec-check, preflight, and
          // command-policy.
          id: z.string(),
          command: z.string(),
          role: z.string(),
          usage: z.enum(["must_exec", "may_exec", "doc_only"]),
        }),
      )
      .describe("Candidate commands to probe, as command descriptors."),
  },
  async execute(args, context) {
    const agentName = (context as any).agent as string | undefined;

    // Guardrail: this tool is reserved for the orch-planner agent. Other agents
    // must not call it directly. We return a SPEC_ERROR-style payload so that
    // callers can detect misuse mechanically.
    if (agentName !== "orch-planner") {
      const msg =
        "SPEC_ERROR: preflight-cli may only be called from the orch-planner agent. Other agents must not invoke this tool directly.";

      const results = args.commands.map<PreflightProbeResult>((item) => ({
        id: item.id,
        command: item.command,
        role: item.role,
        usage: item.usage,
        available: false,
        exit_code: null,
        stderr_excerpt: msg,
      }));

      return JSON.stringify({ status: "failed", results }, null, 2);
    }

    const cwd =
      (context as any).worktree || (context as any).directory || process.cwd();

    const opencodeBin = process.env.OPENCODE_BIN || "opencode";

    // Lightweight JSONL logger for debugging preflight behavior. This writes
    // to the orchestrator state directory for the current task so that we can
    // later inspect how often preflight-cli was invoked and which child
    // `opencode run` processes were spawned.
    let logPath: string | null = null;
    try {
      const stateDir = getOrchestratorStateDir(args.task);
      fs.mkdirSync(stateDir, { recursive: true });
      logPath = path.join(stateDir, "preflight-cli.log");
    } catch {
      logPath = null;
    }

    const log = (entry: Record<string, unknown>): void => {
      if (!logPath) return;
      try {
        const line = JSON.stringify({
          ts: new Date().toISOString(),
          ...entry,
        });
        fs.appendFileSync(logPath, line + "\n", "utf8");
      } catch {
        // Logging failures must never break preflight behavior.
      }
    };

    // Guardrail: preflight-cli MUST only be used when a proper orchestrator
    // state directory for this task already exists (i.e. after Refiner and
    // Spec-Checker have created acceptance-index/spec.md/command-policy). If the
    // state directory or core files are missing, treat this as a spec/flow
    // error and do not spawn any `orch-preflight` sessions.
    const stateDir = getOrchestratorStateDir(args.task);
    const acceptancePath = path.join(stateDir, "acceptance-index.json");
    const specPath = path.join(stateDir, "spec.md");
    const policyPath = path.join(stateDir, "command-policy.json");
    const hasAcceptance = fs.existsSync(acceptancePath);
    const hasSpec = fs.existsSync(specPath);
    const hasPolicy = fs.existsSync(policyPath);

    if (!hasAcceptance || !hasSpec || !hasPolicy) {
      const msg =
        "SPEC_ERROR: preflight-cli requires orchestrator state (acceptance-index.json, spec.md, and command-policy.json) " +
        `for task "${args.task}" before it can be used. Run Refiner first and do not call preflight-cli ` +
        "directly from ad-hoc sessions.";

      log({
        event: "missing_state",
        task: args.task,
        stateDir,
        hasAcceptance,
        hasSpec,
        hasPolicy,
      });

      const results = args.commands.map<PreflightProbeResult>((item) => ({
        id: item.id,
        command: item.command,
        role: item.role,
        usage: item.usage,
        available: false,
        exit_code: null,
        stderr_excerpt: msg,
      }));

      const aggregated = {
        status: "failed" as const,
        results,
      };

      log({ event: "execute_done", status: aggregated.status, results });
      return JSON.stringify(aggregated, null, 2);
    }

    // Include helper commands from helper-commands.json in the probe list.
    const allCommands: CommandDescriptor[] = [
      ...args.commands,
      ...helperCommandsData.helper_commands.map((h) => ({
        id: h.id,
        command: h.probe,
        role: "helper",
        usage: "may_exec" as const,
      })),
    ];

    log({
      event: "execute_start",
      task: args.task,
      cwd,
      commands_count: allCommands.length,
      commands: args.commands.map((c) => ({ id: c.id, command: c.command })),
    });

    emitPreflightMetadata(context, {
      title: `preflight-cli: starting ${allCommands.length} command(s)`,
      task: args.task,
      phase: "starting",
      completed: 0,
      total: allCommands.length,
      status: "running",
    });

    // Evaluate permission.bash rules for each command without spawning
    // any `orch-preflight` sessions. This keeps preflight checks cheap and
    // fully deterministic, relying solely on the effective bash permission
    // map for preflight.
    const results: PreflightProbeResult[] = [];
    const preflightRunnerBashPermission =
      getPreflightRunnerBashPermissionSource();

    for (const item of allCommands) {
      const descriptor: CommandDescriptor = {
        id: item.id,
        command: item.command,
        role: item.role,
        usage: item.usage,
      };

      const permissionCheck = evaluateEffectiveBashPermission(
        descriptor.command,
        preflightRunnerBashPermission,
      );

      results.push({
        id: descriptor.id,
        command: descriptor.command,
        role: descriptor.role,
        usage: descriptor.usage,
        available: permissionCheck.decision === "allow",
        exit_code: permissionCheck.decision === "allow" ? 0 : null,
        stderr_excerpt:
          permissionCheck.matchedPattern !== null
            ? `preflight-cli short-circuit: permission.bash=${permissionCheck.decision} (pattern: ${permissionCheck.matchedPattern})`
            : `preflight-cli short-circuit: permission.bash=${permissionCheck.decision}`,
      });
    }

    const mustExecFailures = results.filter(
      (r) => r.usage === "must_exec" && !r.available,
    );

    const status: "ok" | "failed" =
      mustExecFailures.length === 0 ? "ok" : "failed";

    const aggregated = {
      status,
      results,
    };

    // Best-effort command-policy.json update: reflect helper availability,
    // per-command availability, and loop_status based on preflight results.
    try {
      const stateDir = getOrchestratorStateDir(args.task);
      const policyPath = path.join(stateDir, "command-policy.json");
      if (fs.existsSync(policyPath)) {
        const rawPolicy = fs.readFileSync(policyPath, "utf8");
        const policyJson = JSON.parse(rawPolicy) as {
          version?: number;
          summary?: {
            loop_status?: string;
            available_helper_commands?: string[];
          };
          commands?: {
            id?: string;
            usage?: CommandUsage | string;
            availability?: "available" | "unavailable";
            [key: string]: unknown;
          }[];
        };

        if (policyJson.version === 1 && Array.isArray(policyJson.commands)) {
          const resultById = new Map<string, PreflightProbeResult>();
          for (const r of results) {
            resultById.set(r.id, r);
          }

          // Update available_helper_commands as list of base command names
          const availableHelperCommands = helperCommandsData.helper_commands
            .filter((helper) => {
              const r = resultById.get(helper.id);
              return r && r.available;
            })
            .map((helper) => helper.command);

          if (!policyJson.summary) {
            policyJson.summary = {};
          }
          policyJson.summary.available_helper_commands =
            availableHelperCommands;

          // Update availability for non-helper commands
          for (const cmd of policyJson.commands) {
            if (!cmd.id || cmd.id.startsWith("helper:")) continue;
            const r = resultById.get(cmd.id);
            if (!r) continue;
            cmd.availability = r.available ? "available" : "unavailable";
          }

          // Compute loop_status based on must_exec availability and error kinds.
          const mustExecUnavailable = policyJson.commands.some((cmd) => {
            if (!cmd) return false;
            const usage = String(cmd.usage);
            return usage === "must_exec" && cmd.availability !== "available";
          });

          let loopStatus:
            | "ready_for_loop"
            | "needs_refinement"
            | "blocked_by_environment" = "ready_for_loop";

          if (mustExecUnavailable) {
            const hasSpecError = results.some(
              (r) =>
                r.usage === "must_exec" &&
                !r.available &&
                typeof r.stderr_excerpt === "string" &&
                r.stderr_excerpt.startsWith("SPEC_ERROR:"),
            );
            loopStatus = hasSpecError
              ? "needs_refinement"
              : "blocked_by_environment";
          }

          policyJson.summary.loop_status = loopStatus;

          fs.writeFileSync(
            policyPath,
            JSON.stringify(policyJson, null, 2),
            "utf8",
          );
        }
      }
    } catch (err) {
      log({
        event: "command_policy_update_error",
        error:
          err && (err as Error).message ? (err as Error).message : String(err),
      });
      // Do not throw; preflight results should still be returned.
    }

    log({ event: "execute_done", status, results });

    emitPreflightMetadata(context, {
      title: `preflight-cli: done ${results.length}/${allCommands.length}`,
      task: args.task,
      phase: "completed",
      completed: results.length,
      total: allCommands.length,
      status,
    });
    emitToast({
      title: "preflight-cli",
      message:
        status === "ok"
          ? `All ${results.length} command(s) passed`
          : `${mustExecFailures.length} must_exec command(s) failed out of ${results.length}`,
      variant: status === "ok" ? "success" : "error",
      duration: status === "ok" ? 5000 : 8000,
    });

    return JSON.stringify(aggregated, null, 2);
  },
});

export default preflightCliTool;
