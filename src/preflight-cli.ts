import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import * as fs from "node:fs";
import * as path from "node:path";

import helperCommandsData from "../resources/helper-commands.json" with { type: "json" };
import { getOpencodeClient } from "./opencode-client-store.js";
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { getPreflightRunnerBashPermissionSource } from "./preflight-permission-store.js";
import {
  refreshCommandPolicySummary,
  truncateExcerpt,
} from "./preflight-command-policy.js";
import {
  evaluateBashPermission,
  evaluateEffectiveBashPermission,
  type CommandPermissionDecision,
  type PermissionEvaluationResult,
} from "./preflight-bash-permission.js";
import type {
  CommandDescriptor,
  CommandUsage,
  PreflightProbeResult,
} from "./preflight-types.js";

type ToastVariant = "info" | "success" | "warning" | "error";

function emitToast(input: {
  title?: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}): void {
  try {
    const client = getOpencodeClient();
    if (!client?.tui?.showToast) return;
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

const preflightCliTool: ToolDefinition = tool({
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
    void opencodeBin;

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

    try {
      refreshCommandPolicySummary(args.task, results);
    } catch (err) {
      log({
        event: "command_policy_update_error",
        error:
          err && (err as Error).message ? (err as Error).message : String(err),
      });
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

export type {
  CommandDescriptor,
  CommandUsage,
  PreflightProbeResult,
} from "./preflight-types.js";
export type {
  CommandPermissionDecision,
  PermissionEvaluationResult,
} from "./preflight-bash-permission.js";
export { truncateExcerpt } from "./preflight-command-policy.js";
export {
  evaluateBashPermission,
  evaluateEffectiveBashPermission,
} from "./preflight-bash-permission.js";

export default preflightCliTool;
