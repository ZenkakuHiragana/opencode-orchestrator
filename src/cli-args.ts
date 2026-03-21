import { getOrchestratorStateDir } from "./orchestrator-paths.js";

export interface LoopOptions {
  task: string;
  prompt: string;
  sessionId?: string;
  continueLast: boolean;
  commitOnDone: boolean;
  maxLoop: number;
  // Safety-related options
  maxRestarts: number;
  // Files to attach to each opencode run (user-specified),
  // before adding canonical orchestrator attachments.
  files: string[];
}

export interface ListOptions {
  format: "text" | "json";
}

function printListUsage() {
  console.error(
    "Usage: opencode-orchestrator list [--json]\n" +
      "\n" +
      "List available orchestrator tasks discovered under the orchestrator state directory.",
  );
}

export function parseLoopArgs(argv: string[]): LoopOptions {
  let task: string | undefined;
  let sessionId: string | undefined;
  let continueLast = false;
  let commitOnDone = false;
  let maxLoop = 100;
  let maxRestarts = 20;
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
    files,
  };
}

export function parseListArgs(argv: string[]): ListOptions {
  let format: "text" | "json" = "text";

  for (const arg of argv) {
    if (arg === "--json") {
      format = "json";
    } else if (arg === "--help" || arg === "-h") {
      printListUsage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option for list: ${arg}`);
    } else {
      throw new Error(`unexpected argument for list: ${arg}`);
    }
  }

  return { format };
}
