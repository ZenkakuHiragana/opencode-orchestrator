import * as fs from "node:fs";
import * as path from "node:path";

import { t } from "./i18n/messages.js";
import { parseLoopArgs } from "./cli-args.js";
import { runLoop } from "./orchestrator-loop.js";
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import {
  listKnownTasks,
  sortTasksByRecency,
  suggestRecentTasks,
} from "./task-resolution.js";

export interface ResumeCommandOptions {
  argv: string[];
}

export async function runResumeCommand(
  opts: ResumeCommandOptions,
): Promise<number> {
  const args = [...opts.argv];

  let task: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--task" || args[i] === "-t") {
      task = args[i + 1];
      break;
    }
  }

  if (!task) {
    const infos = listKnownTasks();
    const tasks = infos.map((info) => info.task);

    if (tasks.length === 0) {
      console.error(t("cli.resume.error.no_tasks_found"));
      return 1;
    }

    if (tasks.length > 1) {
      const recent = sortTasksByRecency(infos, 5);
      const shown = recent.map((info) => info.task);
      console.error(
        t("cli.resume.error.multiple_tasks", {
          tasks: shown.join(", "),
        }),
      );
      if (tasks.length > shown.length) {
        console.error(t("cli.resume.info.multiple_tasks_hint_use_list"));
      }
      return 1;
    }

    task = tasks[0];
  }
  const infos = listKnownTasks();
  const knownTasks = infos.map((info) => info.task);

  if (!knownTasks.includes(task)) {
    if (knownTasks.length === 0) {
      console.error(t("cli.resume.error.no_tasks_found"));
      return 1;
    }

    const suggestions = suggestRecentTasks(task, infos, 5);
    if (suggestions.length > 0) {
      const names = suggestions.join(", ");
      console.error(
        t("cli.status.error.unknown_task_with_suggestions", {
          input: task,
          candidates: names,
        }),
      );
      if (infos.length > suggestions.length) {
        console.error(t("cli.resume.info.unknown_task_hint_use_list"));
      }
      return 1;
    }

    console.error(
      t("cli.status.error.unknown_task_no_suggestions", {
        input: task,
      }),
    );
    return 1;
  }

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
    const loopOpts = parseLoopArgs(["--task", task, "--continue"]);
    const done = await runLoop(loopOpts);
    return done ? 0 : 1;
  }

  if (loopStatus === "needs_refinement") {
    console.error(t("cli.resume.info.not_ready_planning", { task }));
    return 1;
  }

  if (loopStatus === "blocked_by_environment") {
    console.error(t("cli.resume.info.not_ready_env", { task }));
    return 1;
  }

  console.error(t("cli.resume.info.not_ready_generic", { task }));
  return 1;
}
