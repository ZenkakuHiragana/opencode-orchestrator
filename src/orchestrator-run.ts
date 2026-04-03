import * as fs from "node:fs";
import * as path from "node:path";

import { t } from "./i18n/messages.js";
import {
  listKnownTasks,
  sortTasksByRecency,
  suggestRecentTasks,
} from "./task-resolution.js";
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import { parseLoopArgs } from "./cli-args.js";
import { runLoop } from "./orchestrator-loop.js";

export interface RunCommandOptions {
  argv: string[];
}

export async function runRunCommand(opts: RunCommandOptions): Promise<number> {
  const args = [...opts.argv];

  let explicitTask: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--task") {
      explicitTask = args[i + 1];
      break;
    }
  }

  const knownInfos = listKnownTasks();
  const knownTasks = knownInfos.map((info) => info.task);

  if (!explicitTask) {
    if (knownTasks.length === 0) {
      console.error(t("cli.run.error.no_tasks_found"));
      return 1;
    }
    if (knownTasks.length > 1) {
      const recent = sortTasksByRecency(knownInfos, 5);
      const shown = recent.map((info) => info.task);
      console.error(
        t("cli.run.error.multiple_tasks", {
          tasks: shown.join(", "),
        }),
      );
      if (knownTasks.length > shown.length) {
        console.error(t("cli.run.info.multiple_tasks_hint_use_list"));
      }
      return 1;
    }

    const task = knownTasks[0];
    return await runForResolvedTask(task);
  }

  if (knownTasks.length === 0) {
    console.error(
      t("cli.run.error.unknown_task_no_suggestions", {
        input: explicitTask,
      }),
    );
    return 1;
  }

  if (knownTasks.includes(explicitTask)) {
    return await runForResolvedTask(explicitTask);
  }

  const suggestions = suggestRecentTasks(explicitTask, knownInfos, 5);
  if (suggestions.length > 0) {
    const names = suggestions.join(", ");
    console.error(
      t("cli.run.error.unknown_task_with_suggestions", {
        input: explicitTask,
        candidates: names,
      }),
    );
    if (knownInfos.length > suggestions.length) {
      console.error(t("cli.run.info.unknown_task_hint_use_list"));
    }
    return 1;
  }

  console.error(
    t("cli.run.error.unknown_task_no_suggestions", {
      input: explicitTask,
    }),
  );
  return 1;
}

async function runForResolvedTask(task: string): Promise<number> {
  const stateDir = getOrchestratorStateDir(task);
  const policyPath = path.join(stateDir, "command-policy.json");

  let loopStatus: string | null = null;
  try {
    const raw = fs.readFileSync(policyPath, "utf8");
    const json = JSON.parse(raw) as {
      summary?: { loop_status?: string };
    };
    const s = json.summary?.loop_status;
    loopStatus = typeof s === "string" ? s : null;
  } catch {
    loopStatus = null;
  }

  if (loopStatus === "ready_for_loop") {
    const loopOpts = parseLoopArgs(["--task", task]);
    const done = await runLoop(loopOpts);
    return done ? 0 : 1;
  }

  console.error(t("cli.run.info.not_ready_generic", { task }));
  return 1;
}
