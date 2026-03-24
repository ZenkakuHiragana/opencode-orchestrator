import { tool } from "@opencode-ai/plugin/tool";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import helperCommandsData from "../resources/helper-commands.json" with { type: "json" };
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { buildOpencodeSpawnPlan } from "./opencode-spawn.js";
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

// Default watchdog timeout for a single `orch-preflight` run. This is a
// coarse-grained guard to avoid hanging `opencode run` processes when the
// preflight-runner gets stuck. Can be overridden via environment variable
// `PREFLIGHT_CLI_TIMEOUT_MS`.
const DEFAULT_PREFLIGHT_TIMEOUT_MS: number = (() => {
  const raw = process.env.PREFLIGHT_CLI_TIMEOUT_MS;
  if (!raw) return 30_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
})();

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

type RunEvent = {
  type: string;
  sessionID?: string;
  part?: {
    tool?: string;
    text?: string;
    state?: {
      status?: string;
      output?: unknown;
      // Optional fields used by the bash tool for probes
      input?: {
        command?: string;
        description?: string;
      };
      error?: string;
    };
  };
};

export function truncateExcerpt(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export type OpencodeRunResult = {
  stdout: string;
  stderr: string;
  code: number;
};

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

// Simple in-process cache to avoid spawning multiple orch-preflight sessions
// for the exact same command in the same working directory. This keeps
// preflight from repeatedly re-probing the same command when orchestration
// logic calls this tool multiple times.
const preflightCache = new Map<string, PreflightProbeResult>();

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

export function interpretPreflightRun(
  descriptor: CommandDescriptor,
  runResult: OpencodeRunResult,
): { result: PreflightProbeResult; sessionID: string | null } {
  if (runResult.code !== 0 && !runResult.stdout.trim()) {
    return {
      sessionID: null,
      result: {
        id: descriptor.id,
        command: descriptor.command,
        role: descriptor.role,
        usage: descriptor.usage,
        available: false,
        exit_code: runResult.code,
        stderr_excerpt:
          runResult.stderr.trim() ||
          "opencode run failed during preflight (no stdout).",
      },
    };
  }

  const lines = runResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let sessionID: string | undefined;
  let jsonText: string | undefined;
  let firstFailedProbeCommand: string | undefined;
  let firstFailedProbeError: string | undefined;
  let firstNonJsonText: string | undefined;

  for (const line of lines) {
    let parsed: RunEvent;
    try {
      parsed = JSON.parse(line) as RunEvent;
    } catch {
      continue;
    }

    if (
      !sessionID &&
      parsed.sessionID &&
      typeof parsed.sessionID === "string"
    ) {
      sessionID = parsed.sessionID;
    }

    if (
      parsed.type === "text" &&
      parsed.part &&
      typeof parsed.part.text === "string"
    ) {
      const text = parsed.part.text.trim();
      // LLM tends to wrap JSON in markdown code fences despite instructions.
      // Strip fences like ```json ... ``` or ``` ... ``` before checking.
      const stripped = text
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();
      if (stripped.startsWith("{") && stripped.endsWith("}")) {
        jsonText = stripped;
      } else if (text.startsWith("{") && text.endsWith("}")) {
        jsonText = text;
      } else if (!firstNonJsonText && text.length > 0) {
        firstNonJsonText = text;
      }
    }

    if (
      parsed.type === "tool_use" &&
      parsed.part &&
      parsed.part.tool === "bash" &&
      parsed.part.state &&
      parsed.part.state.status === "error"
    ) {
      if (!firstFailedProbeCommand) {
        const input = parsed.part.state.input;
        if (input && typeof (input as any).command === "string") {
          firstFailedProbeCommand = (input as any).command as string;
        }
      }
      if (!firstFailedProbeError) {
        const err = parsed.part.state.error;
        if (typeof err === "string" && err.trim().length > 0) {
          firstFailedProbeError = err.trim();
        }
      }
    }
  }

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as {
        status?: string;
        results?: {
          command?: string;
          role?: string | null;
          usage?: CommandUsage;
          available?: boolean;
          exit_code?: number | null;
          stderr_excerpt?: string;
        }[];
      };

      const resultObj =
        Array.isArray(parsed.results) && parsed.results.length > 0
          ? parsed.results[0]
          : undefined;

      if (resultObj) {
        return {
          sessionID: sessionID ?? null,
          result: {
            id: descriptor.id,
            command: resultObj.command || descriptor.command,
            role: resultObj.role ?? descriptor.role,
            usage: resultObj.usage ?? descriptor.usage,
            available: Boolean(resultObj.available),
            exit_code:
              typeof resultObj.exit_code === "number" ||
              resultObj.exit_code === null
                ? resultObj.exit_code
                : null,
            stderr_excerpt: resultObj.stderr_excerpt || "",
          },
        };
      }
    } catch {
      // fall through to fallback handling below
    }
  }

  let stderrBase: string;

  if (firstFailedProbeCommand || firstFailedProbeError) {
    const parts: string[] = [];
    if (firstFailedProbeCommand) {
      parts.push(`preflight probe "${firstFailedProbeCommand}" failed`);
    } else {
      parts.push("preflight probe failed");
    }
    if (firstFailedProbeError) {
      parts.push(firstFailedProbeError);
    }
    stderrBase = parts.join(": ");
  } else {
    const parts: string[] = ["orch-preflight did not produce JSON output"]; // generic summary
    const info: string[] = [];

    if (Number.isFinite(runResult.code)) {
      info.push(`exit code ${runResult.code}`);
    }

    const stderrText = runResult.stderr.trim();
    if (stderrText) {
      const firstLine = stderrText.split("\n")[0].trim();
      if (firstLine.length > 0) {
        info.push(`stderr: ${firstLine}`);
      }
    }

    if (firstNonJsonText) {
      const cleaned = firstNonJsonText.replace(/\s+/g, " ").trim();
      if (cleaned.length > 0) {
        info.push(`raw: ${truncateExcerpt(cleaned)}`);
      }
    }

    if (info.length > 0) {
      parts.push(info.join("; "));
    } else {
      parts.push("permission or runtime error during preflight.");
    }

    stderrBase = parts.join(" - ");
  }

  return {
    sessionID: sessionID ?? null,
    result: {
      id: descriptor.id,
      command: descriptor.command,
      role: descriptor.role,
      usage: descriptor.usage,
      available: false,
      exit_code: null,
      stderr_excerpt: stderrBase,
    },
  };
}

const preflightCliTool = tool({
  description:
    "Helper tool EXCLUSIVE FOR orch-planner agent: run orch-preflight via `opencode run` with non-interactive permission handling and return a per-command JSON result. Do not call this tool from other agents; misuse will return SPEC_ERROR.",
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
        "directly from ad-hoc sessions or orch-preflight-runner.";

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

    async function runOpencode(
      argv: string[],
    ): Promise<{ stdout: string; stderr: string; code: number }> {
      const spawnPlan = buildOpencodeSpawnPlan(opencodeBin, argv);
      log({
        event: "runOpencode_spawn",
        argv,
        command: spawnPlan.command,
        shell: spawnPlan.shell,
        windowsVerbatimArguments: spawnPlan.windowsVerbatimArguments === true,
      });
      return await new Promise((resolve) => {
        const child = spawn(spawnPlan.command, spawnPlan.args, {
          cwd,
          env: process.env,
          shell: spawnPlan.shell,
          windowsVerbatimArguments: spawnPlan.windowsVerbatimArguments,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let out = "";
        let err = "";
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;

          const timeoutMessage = `preflight-cli: opencode ${argv.join(
            " ",
          )} timed out after ${DEFAULT_PREFLIGHT_TIMEOUT_MS} ms`;
          err = err ? `${err}\n${timeoutMessage}` : timeoutMessage;

          try {
            child.kill("SIGKILL");
          } catch {
            // Best-effort; ignore failures.
          }

          log({ event: "runOpencode_timeout", argv, code: 124 });

          resolve({ stdout: out, stderr: err, code: 124 });
        }, DEFAULT_PREFLIGHT_TIMEOUT_MS);

        child.stdout.on("data", (d) => {
          out += d.toString();
        });
        child.stderr.on("data", (d) => {
          err += d.toString();
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const finalCode = code ?? 0;
          log({ event: "runOpencode_close", argv, code: finalCode });
          resolve({ stdout: out, stderr: err, code: finalCode });
        });
      });
    }

    async function runSinglePreflight(
      descriptor: CommandDescriptor,
      progress: { completed: number; total: number },
    ): Promise<PreflightProbeResult> {
      const title = [
        "__preflight__",
        args.task,
        descriptor.command,
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 10),
      ].join(":");

      const payload: CommandDescriptor[] = [
        {
          id: descriptor.id,
          command: descriptor.command,
          role: descriptor.role,
          usage: descriptor.usage,
        },
      ];

      const runArgs = [
        "run",
        "--format",
        "json",
        "--command",
        "orch-preflight",
        "--title",
        title,
        "--dir",
        cwd,
        JSON.stringify(payload),
      ];

      // Simple retry loop to handle transient assistant failures such as
      // "I'm sorry, but I cannot assist with that request" or cases where the
      // agent stops without emitting JSON. We keep this very conservative:
      // a small fixed number of retries with the same arguments.
      emitPreflightMetadata(context, {
        title: `preflight-cli: ${progress.completed + 1}/${progress.total} ${descriptor.command}`,
        task: args.task,
        phase: "probing",
        completed: progress.completed,
        total: progress.total,
        command: descriptor.command,
        commandId: descriptor.id,
        attempt: 1,
        status: "running",
      });

      let runResult = await runOpencode(runArgs);
      let { result, sessionID } = interpretPreflightRun(descriptor, runResult);

      const maxAttempts = 3;
      let attempt = 1;
      while (
        attempt < maxAttempts &&
        !result.available &&
        !result.stderr_excerpt.startsWith("SPEC_ERROR:") &&
        result.stderr_excerpt.includes("did not produce JSON output")
      ) {
        attempt += 1;
        log({
          event: "runSinglePreflight_retry",
          id: descriptor.id,
          command: descriptor.command,
          attempt,
          previous_stderr: result.stderr_excerpt,
        });
        emitPreflightMetadata(context, {
          title: `preflight-cli: retry ${attempt}/${maxAttempts} ${descriptor.command}`,
          task: args.task,
          phase: "retrying",
          completed: progress.completed,
          total: progress.total,
          command: descriptor.command,
          commandId: descriptor.id,
          attempt,
          status: "running",
        });
        runResult = await runOpencode(runArgs);
        ({ result, sessionID } = interpretPreflightRun(descriptor, runResult));
      }

      log({
        event: "runSinglePreflight_result",
        id: descriptor.id,
        command: descriptor.command,
        title,
        exit_code: runResult.code,
        available: result.available,
      });

      if (sessionID) {
        const deleteArgs = ["session", "delete", sessionID];
        try {
          log({ event: "runSinglePreflight_session_delete", sessionID });
          await runOpencode(deleteArgs);
        } catch {
          // Best-effort cleanup; ignore failures.
        }
      }

      return result;
    }

    // Process commands one by one. We keep the execution sequential to preserve
    // output ordering. When the same command string appears multiple times in a
    // single call, we only probe it once. In addition, we maintain an
    // in-process cache keyed by (cwd, command) so that repeated calls to this
    // tool with the same command do not spawn additional orch-preflight
    // sessions.
    const results = [] as {
      id: string;
      command: string;
      role: string | null;
      usage: CommandUsage;
      available: boolean;
      exit_code: number | null;
      stderr_excerpt: string;
    }[];

    const seenCommands = new Set<string>();
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
      if (permissionCheck.determined) {
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
        continue;
      }

      const commandKey = descriptor.command.trim();
      const cacheKey = `${cwd}::${commandKey}`;
      const progress = {
        completed: results.length,
        total: allCommands.length,
      };

      // If we have a cached result for this command in this working directory,
      // reuse it instead of spawning another orch-preflight session.
      const cached = preflightCache.get(cacheKey);
      if (cached) {
        log({
          event: "cache_hit",
          cacheKey,
          id: descriptor.id,
          command: descriptor.command,
        });
        emitPreflightMetadata(context, {
          title: `preflight-cli: cache ${results.length + 1}/${allCommands.length} ${descriptor.command}`,
          task: args.task,
          phase: "cache_hit",
          completed: results.length,
          total: allCommands.length,
          command: descriptor.command,
          commandId: descriptor.id,
          status: "running",
        });
        results.push({
          id: descriptor.id,
          command: descriptor.command,
          role: descriptor.role,
          usage: descriptor.usage,
          available: cached.available,
          exit_code: cached.exit_code,
          stderr_excerpt: cached.stderr_excerpt,
        });
        continue;
      }

      // Within a single call, avoid probing the same command string multiple
      // times even if it appears in several descriptors.
      if (seenCommands.has(commandKey)) {
        continue;
      }
      seenCommands.add(commandKey);

      log({
        event: "run_preflight",
        cacheKey,
        id: descriptor.id,
        command: descriptor.command,
      });

      const res = await runSinglePreflight(descriptor, progress);
      results.push(res);
      preflightCache.set(cacheKey, res);
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
            helper_availability?: Record<string, "available" | "unavailable">;
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

          // Update helper_availability
          const helperAvailability: Record<
            string,
            "available" | "unavailable"
          > = policyJson.summary?.helper_availability
            ? { ...policyJson.summary.helper_availability }
            : {};
          for (const helper of helperCommandsData.helper_commands) {
            const r = resultById.get(helper.id);
            helperAvailability[helper.id] =
              r && r.available ? "available" : "unavailable";
          }

          if (!policyJson.summary) {
            policyJson.summary = {};
          }
          policyJson.summary.helper_availability = helperAvailability;

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
