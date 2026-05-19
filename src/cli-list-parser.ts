import type { ListOptions } from "./cli-types.js";

export function parseListArgs(argv: string[]): ListOptions {
  let format: "text" | "json" = "text";
  let task: string | undefined;
  let showProposals = false;
  let openOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      format = "json";
    } else if (arg === "--task" || arg === "-t") {
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
