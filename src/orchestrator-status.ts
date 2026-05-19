import { parseStatusArgs } from "./cli-args.js";
import { t } from "./i18n/messages.js";
import {
  listKnownTasks,
  sortTasksByRecency,
  suggestRecentTasks,
} from "./task-resolution.js";
import { printStatusSummary } from "./orchestrator-status-summary.js";

export type {
  AuditorFailureKind,
  AuditorReportSnapshot,
  AuditorRequirementSnapshot,
  ExecutorAuditSnapshot,
  ExecutorBlockerSnapshot,
  ExecutorCmdSnapshot,
  ExecutorDiffSnapshot,
  ExecutorIntentSnapshot,
  ExecutorStepSnapshot,
  ExecutorTodoSnapshot,
  ExecutorVerificationEvidence,
  ExecutorVerificationSnapshot,
  FailureBudgetSnapshot,
  OrchestratorStatus,
  RequirementDiffTrace,
  StatusPhase,
  TaskStatusSnapshot,
} from "./orchestrator-status-types.js";
export {
  countBlockingOpenProposals,
  countOpenProposals,
  derivePhase,
  inspectTaskStatus,
  loadStatusJson,
  readLatestBlockingOpenProposalSummary,
  readLatestOpenProposalSummary,
  readLoopStatus,
  saveStatusJson,
} from "./orchestrator-status-store.js";
export {
  buildRequirementDiffTrace,
  getExecutorVerificationEvidence,
  parseExecutorStepSnapshot,
} from "./orchestrator-executor-output.js";

export interface StatusCommandOptions {
  argv: string[];
}

export async function runStatusCommand(
  opts: StatusCommandOptions,
): Promise<number> {
  let explicitTask: string | undefined;
  try {
    explicitTask = parseStatusArgs(opts.argv).task;
  } catch (error) {
    console.error(String((error as Error).message ?? error));
    return 1;
  }

  const knownInfos = listKnownTasks();
  const knownTasks = knownInfos.map((info) => info.task);

  let task: string;

  if (!explicitTask) {
    if (knownTasks.length === 0) {
      console.error(t("cli.status.error.no_tasks_found"));
      return 1;
    }
    if (knownTasks.length > 1) {
      const recent = sortTasksByRecency(knownInfos, 5);
      const shown = recent.map((info) => info.task);
      console.error(
        t("cli.status.error.multiple_tasks", {
          tasks: shown.join(", "),
        }),
      );
      if (knownTasks.length > shown.length) {
        console.error(t("cli.status.info.multiple_tasks_hint_use_list"));
      }
      return 1;
    }
    task = knownTasks[0];
  } else {
    if (knownTasks.length === 0) {
      console.error(
        t("cli.status.error.unknown_task_no_suggestions", {
          input: explicitTask,
        }),
      );
      return 1;
    }

    if (!knownTasks.includes(explicitTask)) {
      const suggestions = suggestRecentTasks(explicitTask, knownInfos, 5);
      if (suggestions.length > 0) {
        const names = suggestions.join(", ");
        console.error(
          t("cli.status.error.unknown_task_with_suggestions", {
            input: explicitTask,
            candidates: names,
          }),
        );
        if (knownInfos.length > suggestions.length) {
          console.error(t("cli.status.info.unknown_task_hint_use_list"));
        }
        return 1;
      }

      console.error(
        t("cli.status.error.unknown_task_no_suggestions", {
          input: explicitTask,
        }),
      );
      return 1;
    }

    task = explicitTask;
  }

  return printStatusSummary(task);
}
