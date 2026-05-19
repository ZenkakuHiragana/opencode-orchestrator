import { t } from "./i18n/messages.js";
import { parseFixArgs } from "./cli-args.js";
import {
  listKnownTasks,
  sortTasksByRecency,
  suggestRecentTasks,
} from "./task-resolution.js";
import { inspectTaskStatus } from "./orchestrator-status.js";

export interface FixCommandOptions {
  argv: string[];
}

function diagnoseTask(task: string): number {
  const snapshot = inspectTaskStatus(task);
  if (!snapshot) {
    console.error(t("cli.fix.info.not_ready_generic", { task }));
    return 1;
  }

  const failedRequirements =
    snapshot.status.last_auditor_report?.requirements?.filter(
      (requirement) => requirement.passed === false,
    ) ?? [];

  if (snapshot.phase === "completed") {
    console.error(
      t("cli.fix.info.completed", {
        task,
      }),
    );
    return 0;
  }

  if (snapshot.phase === "execution_ready") {
    console.error(
      t("cli.fix.info.execution_ready", {
        task,
      }),
    );
    return 0;
  }

  if (snapshot.phase === "proposal_blocked") {
    console.error(
      t("cli.fix.info.proposal_blocked", {
        task,
        count: String(snapshot.blockingOpenProposalCount),
        summary:
          snapshot.latestBlockingOpenProposalSummary ||
          snapshot.latestOpenProposalSummary ||
          t("cli.fix.info.no_summary"),
      }),
    );
    return 1;
  }

  if (snapshot.phase === "env_blocked") {
    console.error(
      t("cli.fix.info.env_blocked", {
        task,
      }),
    );
    if (snapshot.lastFailureSummary) {
      console.error(
        t("cli.fix.info.last_failure", {
          summary: snapshot.lastFailureSummary,
        }),
      );
    }
    return 1;
  }

  if (snapshot.phase === "planning") {
    console.error(
      t("cli.fix.info.planning_blocked", {
        task,
      }),
    );
    if (snapshot.openProposalCount > 0 && snapshot.latestOpenProposalSummary) {
      console.error(
        t("cli.fix.info.open_proposals", {
          count: String(snapshot.openProposalCount),
          summary: snapshot.latestOpenProposalSummary,
          task,
        }),
      );
    }
    return 1;
  }

  if (failedRequirements.length > 0) {
    const requirements = failedRequirements.map((req) => req.id).join(", ");
    const auditKey =
      snapshot.openProposalCount > 0
        ? "cli.fix.info.audit_failed_with_proposals"
        : "cli.fix.info.audit_failed";
    console.error(
      t(auditKey as never, {
        task,
        requirements,
      }),
    );
    const firstReason = failedRequirements[0]?.reason?.trim();
    if (firstReason) {
      console.error(
        t("cli.fix.info.first_requirement_reason", {
          reason: firstReason,
        }),
      );
    }
    return 1;
  }

  if (snapshot.openProposalCount > 0 && snapshot.latestOpenProposalSummary) {
    console.error(
      t("cli.fix.info.open_proposals", {
        count: String(snapshot.openProposalCount),
        summary: snapshot.latestOpenProposalSummary,
        task,
      }),
    );
    return 1;
  }

  if (snapshot.lastFailureSummary) {
    console.error(
      t("cli.fix.info.last_failure_only", {
        task,
        summary: snapshot.lastFailureSummary,
      }),
    );
    return 1;
  }

  console.error(
    t("cli.fix.info.not_ready_generic", {
      task,
    }),
  );
  return 1;
}

export async function runFixCommand(opts: FixCommandOptions): Promise<number> {
  let explicitTask: string | undefined;
  try {
    explicitTask = parseFixArgs(opts.argv).task;
  } catch (error) {
    console.error(String((error as Error).message ?? error));
    return 1;
  }

  const knownInfos = listKnownTasks();
  const knownTasks = knownInfos.map((info) => info.task);

  if (!explicitTask) {
    if (knownTasks.length === 0) {
      console.error(t("cli.fix.error.no_tasks_found"));
      return 1;
    }
    if (knownTasks.length > 1) {
      const recentInfos = sortTasksByRecency(knownInfos);
      const recentTasks = recentInfos.map((info) => info.task);

      console.error(
        t("cli.fix.error.multiple_tasks", {
          tasks: recentTasks.join(", "),
        }),
      );

      if (knownInfos.length > recentInfos.length) {
        console.error(t("cli.fix.info.multiple_tasks_hint_use_list"));
      }

      return 1;
    }

    const task = knownTasks[0];
    return diagnoseTask(task);
  }

  if (knownTasks.length === 0) {
    console.error(
      t("cli.fix.error.unknown_task_no_suggestions", {
        input: explicitTask,
      }),
    );
    return 1;
  }

  if (knownTasks.includes(explicitTask)) {
    return diagnoseTask(explicitTask);
  }

  const suggestions = suggestRecentTasks(explicitTask, knownInfos, 5);
  if (suggestions.length > 0) {
    const names = suggestions.join(", ");
    console.error(
      t("cli.fix.error.unknown_task_with_suggestions", {
        input: explicitTask,
        candidates: names,
      }),
    );
    if (knownInfos.length > suggestions.length) {
      console.error(t("cli.fix.info.unknown_task_hint_use_list"));
    }
    return 1;
  }

  console.error(
    t("cli.fix.error.unknown_task_no_suggestions", {
      input: explicitTask,
    }),
  );
  return 1;
}
