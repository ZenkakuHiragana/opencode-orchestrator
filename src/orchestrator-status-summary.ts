import { t } from "./i18n/messages.js";
import { inspectTaskStatus } from "./orchestrator-status-store.js";

export function printStatusSummary(task: string): number {
  const snapshot = inspectTaskStatus(task);
  if (!snapshot) {
    console.error(t("cli.status.error.state_missing", { task }));
    return 1;
  }

  const {
    phase,
    openProposalCount: openCount,
    lastFailureSummary,
    latestBlockingOpenProposalSummary,
  } = snapshot;

  console.error(t("cli.status.summary.header", { task }));

  switch (phase) {
    case "planning":
      console.error(t("cli.status.summary.phase.planning"));
      break;
    case "proposal_blocked":
      console.error(t("cli.status.summary.phase.proposal_blocked"));
      break;
    case "execution_ready":
      console.error(t("cli.status.summary.phase.execution_ready"));
      break;
    case "env_blocked":
      console.error(t("cli.status.summary.phase.env_blocked"));
      break;
    case "completed":
      console.error(t("cli.status.summary.phase.completed"));
      break;
    default:
      console.error(t("cli.status.summary.phase.unknown"));
      break;
  }

  if (lastFailureSummary.length > 0) {
    console.error(
      t("cli.status.summary.last_failure", {
        summary: lastFailureSummary,
      }),
    );
  }

  if (openCount === 0) {
    console.error(t("cli.status.summary.open_proposals.none"));
  } else {
    console.error(
      t("cli.status.summary.open_proposals.some", {
        count: String(openCount),
      }),
    );
    if (phase === "proposal_blocked" && latestBlockingOpenProposalSummary) {
      console.error(
        t("cli.status.summary.open_proposals.latest", {
          summary: latestBlockingOpenProposalSummary,
        }),
      );
    }
  }

  let nextActionKey: string;
  switch (phase) {
    case "planning":
      nextActionKey = "cli.status.summary.next_action.planning";
      break;
    case "proposal_blocked":
      nextActionKey = "cli.status.summary.next_action.proposal_blocked";
      break;
    case "env_blocked":
      nextActionKey = "cli.status.summary.next_action.env_blocked";
      break;
    case "execution_ready":
      nextActionKey = "cli.status.summary.next_action.execution_ready";
      break;
    case "completed":
      nextActionKey = "cli.status.summary.next_action.completed";
      break;
    default:
      nextActionKey = "cli.status.summary.next_action.unknown";
      break;
  }

  console.error(
    t(nextActionKey as never, {
      task,
    }),
  );

  return 0;
}
