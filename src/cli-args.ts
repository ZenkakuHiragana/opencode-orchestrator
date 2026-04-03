import path from "node:path";
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { t } from "./i18n/messages.js";

export interface LoopOptions {
  task: string;
  prompt: string;
  sessionId?: string;
  continueLast: boolean;
  commitOnDone: boolean;
  maxLoop: number;
  // Safety-related options
  maxRestarts: number;
  // When true, skip command-policy.json gate and relax Executor command
  // restrictions **without** any sandbox. This is intentionally very
  // dangerous and should only be used for local experimentation.
  dangerouslySkipCommandPolicy: boolean;
  // When true, attempt to run the Executor step (opencode run --command
  // orch-exec ...) inside a Bubblewrap sandbox and also skip the
  // command-policy.json gate. This is still dangerous, but intended to be
  // "dangerous with an external sandbox". On non-Linux platforms or when
  // Bubblewrap is unavailable, this flag is ignored and the loop falls back
  // to the normal policy-respecting mode.
  bwrapSkipCommandPolicy: boolean;
  // Extra arguments to pass to `bwrap` when bwrapSkipCommandPolicy is
  // enabled. Each entry corresponds to a single CLI argument. The user is
  // responsible for constructing a valid Bubblewrap invocation (bind
  // mounts, namespaces, etc.).
  bwrapArgs: string[];
  // Files to attach to each opencode run (user-specified),
  // before adding canonical orchestrator attachments.
  files: string[];
}

export interface ListOptions {
  format: "text" | "json";
  task?: string;
  showProposals?: boolean;
  openOnly?: boolean;
}

export interface ExecOptions {
  allowFsRead: string[];
  allowFsWrite: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  filePath?: string;
  scriptSource: string;
  scriptArgs: string[];
}

export function printListUsage() {
  console.error(t("cli.list.usage"));
}

export function printExecUsage() {
  console.error(t("cli.exec.usage"));
}

function validateRelativePathSpec(spec: string, flag: string): void {
  if (path.isAbsolute(spec) || /^[A-Za-z]:/.test(spec)) {
    throw new Error(
      `${flag} must be a workspace-relative path or glob: ${spec}`,
    );
  }

  const normalized = spec.replace(/\\/g, "/");
  for (const segment of normalized.split("/")) {
    if (segment === "..") {
      throw new Error(`${flag} must not contain .. path traversal: ${spec}`);
    }
  }
}

export function printLoopUsage() {
  console.error(t("cli.loop.usage"));
}

export function parseLoopArgs(argv: string[]): LoopOptions {
  let task: string | undefined;
  let sessionId: string | undefined;
  let continueLast = false;
  let commitOnDone = false;
  let maxLoop = 100;
  let maxRestarts = 20;
  let dangerouslySkipCommandPolicy = false;
  let bwrapSkipCommandPolicy = false;
  const bwrapArgs: string[] = [];
  const files: string[] = [];

  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--task") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--task requires a task name");
      }
      task = next;
    } else if (arg === "--session") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--session requires a session id");
      }
      sessionId = next;
    } else if (arg === "--continue") {
      continueLast = true;
    } else if (arg === "--commit") {
      commitOnDone = true;
    } else if (arg === "--max-loop") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--max-loop requires a number");
      }
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--max-loop must be a positive number");
      }
      maxLoop = n;
    } else if (arg === "--max-restarts") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--max-restarts requires a number");
      }
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("--max-restarts must be a non-negative number");
      }
      maxRestarts = n;
    } else if (arg === "--dangerously-skip-command-policy") {
      dangerouslySkipCommandPolicy = true;
    } else if (arg === "--bwrap-skip-command-policy") {
      bwrapSkipCommandPolicy = true;
    } else if (arg === "--bwrap-arg") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--bwrap-arg requires an argument");
      }
      bwrapArgs.push(next);
    } else if (arg === "--file" || arg === "-f") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--file requires a file path");
      }
      files.push(next);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      rest.push(arg);
    }
  }

  if (!task) {
    throw new Error("--task is required");
  }

  if (sessionId && continueLast) {
    throw new Error("--session and --continue are mutually exclusive");
  }

  let prompt = rest.join(" ");
  if (!prompt) {
    // Fallback to a spec-driven prompt. The actual file contents are made
    // available via --file attachments; the @ prefix is treated as a
    // human-readable hint, not a magical include.
    const taskName = task!;
    const stateDir = getOrchestratorStateDir(taskName);
    prompt =
      `You are planning and executing the orchestrated story for task key "${taskName}". ` +
      `All orchestrator state for this task lives under: ${stateDir}. ` +
      "Use the attached spec.md as the high-level goal, scope, and acceptance interpretation guide for this run. " +
      "If an attached acceptance-index.json exists for this task key, treat it as the canonical list of requirements for this task only (do not reuse acceptance-index files from other tasks).";
  }

  return {
    task,
    prompt,
    sessionId,
    continueLast,
    commitOnDone,
    maxLoop,
    maxRestarts,
    dangerouslySkipCommandPolicy,
    bwrapSkipCommandPolicy,
    bwrapArgs,
    files,
  };
}

export function parseListArgs(argv: string[]): ListOptions {
  let format: "text" | "json" = "text";
  let task: string | undefined;
  let showProposals = false;
  let openOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      format = "json";
    } else if (arg === "--task") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--task requires a task name");
      }
      task = next;
    } else if (arg === "--proposals") {
      showProposals = true;
    } else if (arg === "--open") {
      openOnly = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option for list: ${arg}`);
    } else {
      throw new Error(`unexpected argument for list: ${arg}`);
    }
  }

  if (showProposals && !task) {
    throw new Error("--proposals requires --task <task-name>");
  }

  return { format, task, showProposals, openOnly };
}

function pushSpecs(target: string[], value: string): void {
  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (trimmed) target.push(trimmed);
  }
}

export function parseExecArgs(argv: string[]): ExecOptions {
  const allowFsRead: string[] = [];
  const allowFsWrite: string[] = [];
  const scriptArgs: string[] = [];
  let timeoutMs = 30000;
  let maxOutputBytes = 65536;
  let filePath: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-fs-read") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--allow-fs-read requires a path");
      }
      validateRelativePathSpec(next, "--allow-fs-read");
      pushSpecs(allowFsRead, next);
    } else if (arg === "--allow-fs-write") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--allow-fs-write requires a path");
      }
      validateRelativePathSpec(next, "--allow-fs-write");
      pushSpecs(allowFsWrite, next);
    } else if (arg === "--timeout") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--timeout requires a number");
      }
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--timeout must be a positive number");
      }
      timeoutMs = n;
    } else if (arg === "--max-output") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--max-output requires a number");
      }
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--max-output must be a positive number");
      }
      maxOutputBytes = n;
    } else if (arg === "--file") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--file requires a path");
      }
      filePath = next;
    } else if (arg === "--arg") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--arg requires a value");
      }
      scriptArgs.push(next);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option for exec: ${arg}`);
    } else {
      rest.push(arg);
    }
  }

  if (filePath && rest.length > 0) {
    throw new Error("--file cannot be combined with inline helper source text");
  }

  const scriptSource = filePath ? "" : rest.join(" ");

  return {
    allowFsRead,
    allowFsWrite,
    timeoutMs,
    maxOutputBytes,
    filePath,
    scriptSource,
    scriptArgs,
  };
}
