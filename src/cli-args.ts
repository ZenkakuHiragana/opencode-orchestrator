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
  task?: string;
  showProposals?: boolean;
}

export function printListUsage() {
  console.error(
    "Usage: opencode-orchestrator list [--json] [--task <task-name> --proposals]\n" +
      "\n" +
      "List available orchestrator tasks discovered under the orchestrator state directory.\n" +
      "\n" +
      "Options:\n" +
      "  --json                Output as JSON array\n" +
      "  --task <name>         Limit operations to a single task (used with --proposals)\n" +
      "  --proposals           Show proposals for the specified task instead of the task list",
  );
}

export function printLoopUsage() {
  console.error(
    "Usage: opencode-orchestrator loop --task <task-name> [options] [prompt]\n" +
      "\n" +
      "Run an orchestrator loop for the specified task.\n" +
      "\n" +
      "Required:\n" +
      "  --task <name>        Task key to run (e.g., 'my-task')\n" +
      "\n" +
      "Options:\n" +
      "  --session <id>      Session ID for persistence\n" +
      "  --continue           Continue from last session\n" +
      "  --commit             Auto-commit changes when done\n" +
      "  --max-loop <n>      Maximum loop iterations (default: 100)\n" +
      "  --max-restarts <n>  Maximum safety restarts (default: 20)\n" +
      "  --file, -f <path>   Attach file to each step\n" +
      "  --help, -h          Show this help message\n" +
      "\n" +
      "The prompt argument is optional. If omitted, uses spec-driven prompts.",
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
  let task: string | undefined;
  let showProposals = false;

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
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option for list: ${arg}`);
    } else {
      throw new Error(`unexpected argument for list: ${arg}`);
    }
  }

  if (showProposals && !task) {
    throw new Error("--proposals requires --task <task-name>");
  }

  return { format, task, showProposals };
}
