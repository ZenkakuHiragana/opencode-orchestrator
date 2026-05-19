import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import {
  countOpenNonAutoResolvableProposals,
  getLatestBlockingOpenProposal,
  getLatestOpenProposal,
  getOpenProposals,
  loadProposals,
} from "./orchestrator-proposals.js";
import type {
  OrchestratorStatus,
  StatusPhase,
  TaskStatusSnapshot,
} from "./orchestrator-status-types.js";

export function derivePhase(
  loopStatus: string | null,
  status: OrchestratorStatus,
  blockingOpenProposalCount = 0,
): StatusPhase {
  const report = status.last_auditor_report;
  if (
    report &&
    report.audit_mode === "final_full" &&
    report.done &&
    Array.isArray(report.requirements) &&
    report.requirements.length > 0 &&
    report.requirements.every((r) => r.passed)
  ) {
    return "completed";
  }

  if (loopStatus === "needs_refinement") return "planning";
  if (loopStatus === "blocked_by_environment") return "env_blocked";
  if (loopStatus === "ready_for_loop" && blockingOpenProposalCount > 0) {
    return "proposal_blocked";
  }
  if (loopStatus === "ready_for_loop") return "execution_ready";

  return "unknown";
}

export function countOpenProposals(proposalsPath: string): number {
  return getOpenProposals(loadProposals(proposalsPath)).length;
}

export function countBlockingOpenProposals(proposalsPath: string): number {
  return countOpenNonAutoResolvableProposals(loadProposals(proposalsPath));
}

export function readLatestOpenProposalSummary(proposalsPath: string): string {
  const proposal = getLatestOpenProposal(loadProposals(proposalsPath));
  return proposal?.summary?.trim() ?? "";
}

export function readLatestBlockingOpenProposalSummary(
  proposalsPath: string,
): string {
  const proposal = getLatestBlockingOpenProposal(loadProposals(proposalsPath));
  return proposal?.summary?.trim() ?? "";
}

export function readLoopStatus(policyPath: string): string | null {
  try {
    const raw = fs.readFileSync(policyPath, "utf8");
    const json = JSON.parse(raw) as {
      summary?: { loop_status?: string };
    };
    const s = json.summary?.loop_status;
    return typeof s === "string" ? s : null;
  } catch {
    return null;
  }
}

export function loadStatusJson(statusPath: string): OrchestratorStatus {
  if (!fs.existsSync(statusPath)) {
    return { version: 1 };
  }
  try {
    const raw = fs.readFileSync(statusPath, "utf8");
    const parsed = JSON.parse(raw) as OrchestratorStatus;
    if (!parsed || parsed.version !== 1) {
      return { version: 1 };
    }
    return parsed;
  } catch {
    return { version: 1 };
  }
}

export function saveStatusJson(
  statusPath: string,
  status: OrchestratorStatus,
): void {
  try {
    const dir = path.dirname(statusPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
  } catch {
    // Status updates are best-effort; do not break the loop on failure.
  }
}

export function inspectTaskStatus(task: string): TaskStatusSnapshot | null {
  const stateDir = getOrchestratorStateDir(task);
  if (!fs.existsSync(stateDir) || !fs.statSync(stateDir).isDirectory()) {
    return null;
  }

  const statusPath = path.join(stateDir, "status.json");
  const policyPath = path.join(stateDir, "command-policy.json");
  const proposalsPath = path.join(stateDir, "proposals.json");

  const status = loadStatusJson(statusPath);
  const loopStatus = readLoopStatus(policyPath);
  const openCount = countOpenProposals(proposalsPath);
  const blockingOpenCount = countBlockingOpenProposals(proposalsPath);
  const latestBlockingOpenProposalSummary =
    readLatestBlockingOpenProposalSummary(proposalsPath);
  const latestOpenProposalSummary =
    readLatestOpenProposalSummary(proposalsPath);
  const phase = derivePhase(loopStatus, status, blockingOpenCount);
  const lastFailureSummary =
    status.failure_budget?.last_failure_summary?.trim() || "";

  return {
    task,
    stateDir,
    status,
    loopStatus,
    phase,
    openProposalCount: openCount,
    blockingOpenProposalCount: blockingOpenCount,
    latestBlockingOpenProposalSummary,
    latestOpenProposalSummary,
    lastFailureSummary,
  };
}
