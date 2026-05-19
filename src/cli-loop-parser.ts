import { getCliOptionSpecs } from "./cli-contract.js";
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import type { LoopOptions } from "./cli-types.js";

const loopOptionsWithValue = new Set(
  getCliOptionSpecs("loop")
    .filter((spec) => spec.takesValue)
    .map((spec) => spec.value),
);

const loopOptionsWithoutValue = new Set(
  getCliOptionSpecs("loop")
    .filter((spec) => !spec.takesValue)
    .map((spec) => spec.value),
);

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
    if (arg === "--task" || arg === "-t") {
      const next = argv[++i];
      if (!next) throw new Error("--task requires a task name");
      task = next;
    } else if (arg === "--session") {
      const next = argv[++i];
      if (!next) throw new Error("--session requires a session id");
      sessionId = next;
    } else if (arg === "--continue") {
      continueLast = true;
    } else if (arg === "--commit") {
      commitOnDone = true;
    } else if (arg === "--max-loop") {
      const next = argv[++i];
      if (!next) throw new Error("--max-loop requires a number");
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--max-loop must be a positive number");
      }
      maxLoop = n;
    } else if (arg === "--max-restarts") {
      const next = argv[++i];
      if (!next) throw new Error("--max-restarts requires a number");
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("--max-restarts must be a non-negative number");
      }
      maxRestarts = n;
    } else if (arg === "--dangerously-skip-command-policy") {
      dangerouslySkipCommandPolicy = true;
    } else if (arg === "--bwrap-skip-command-policy") {
      bwrapSkipCommandPolicy = true;
    } else if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    } else if (arg === "--bwrap-arg") {
      const next = argv[++i];
      if (!next) throw new Error("--bwrap-arg requires an argument");
      bwrapArgs.push(next);
    } else if (arg === "--file" || arg === "-f") {
      const next = argv[++i];
      if (!next) throw new Error("--file requires a file path");
      files.push(next);
    } else if (bwrapSkipCommandPolicy && arg.startsWith("-")) {
      bwrapArgs.push(arg);
    } else if (loopOptionsWithoutValue.has(arg)) {
      // handled above; keep explicit canonical surface sync
    } else if (loopOptionsWithValue.has(arg)) {
      throw new Error(`unhandled loop option parser branch: ${arg}`);
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
    const stateDir = getOrchestratorStateDir(task);
    prompt =
      `You are planning and executing the orchestrated story for task key "${task}". ` +
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
