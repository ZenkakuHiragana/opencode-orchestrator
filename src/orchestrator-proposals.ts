import * as fs from "node:fs";
import * as path from "node:path";

export type ProposalSource = "executor" | "auditor" | "todo_writer";

export type KnownProposalKind =
  | "env_blocked"
  | "need_replan"
  | "verification_gap"
  | "contract_gap"
  | "audit_failure"
  | "scope_change"
  | "priority_shift";

export type ProposalKind = KnownProposalKind | (string & {});

export type ProposalPriority = "low" | "medium" | "high" | "critical";
export type ProposalStatus = "open" | "resolved" | "dismissed";
export type ProposalResolvedBy = "cli" | "planner" | "todo_writer" | "auto";

export type ProposalEntry = {
  id: string;
  source: ProposalSource;
  cycle: number;
  kind: ProposalKind;
  priority: ProposalPriority;
  summary: string;
  details?: string;
  related_requirement_ids: string[];
  related_todo_ids: string[];
  status: ProposalStatus;
  auto_resolvable: boolean;
  created_at: string;
  resolved_at?: string;
  resolved_by?: ProposalResolvedBy;
};

export type ProposalsFile = {
  version: 1;
  proposals: ProposalEntry[];
};

export type ProposalCreateInput = {
  source: ProposalSource;
  cycle: number;
  kind: ProposalKind;
  priority: ProposalPriority;
  summary: string;
  details?: string;
  related_requirement_ids?: string[];
  related_todo_ids?: string[];
  auto_resolvable?: boolean;
  status?: ProposalStatus;
  created_at?: string;
  resolved_at?: string;
  resolved_by?: ProposalResolvedBy;
};

const EMPTY_PROPOSALS_FILE: ProposalsFile = {
  version: 1,
  proposals: [],
};

export function createProposalEntry(input: ProposalCreateInput): ProposalEntry {
  return {
    id: `p-${Date.now().toString()}-${input.kind}`,
    source: input.source,
    cycle: input.cycle,
    kind: input.kind,
    priority: input.priority,
    summary: input.summary,
    details: input.details,
    related_requirement_ids: input.related_requirement_ids ?? [],
    related_todo_ids: input.related_todo_ids ?? [],
    status: input.status ?? "open",
    auto_resolvable: input.auto_resolvable ?? true,
    created_at: input.created_at ?? new Date().toISOString(),
    resolved_at: input.resolved_at,
    resolved_by: input.resolved_by,
  };
}

export function getOpenProposals(file: ProposalsFile): ProposalEntry[] {
  return file.proposals.filter((proposal) => proposal.status === "open");
}

function proposalTimeMs(proposal: ProposalEntry): number {
  const parsed = Date.parse(proposal.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getOpenProposalsSortedByRecency(
  file: ProposalsFile,
): ProposalEntry[] {
  return [...getOpenProposals(file)].sort((a, b) => {
    const timeDelta = proposalTimeMs(b) - proposalTimeMs(a);
    if (timeDelta !== 0) return timeDelta;
    if (b.cycle !== a.cycle) return b.cycle - a.cycle;
    return a.id.localeCompare(b.id);
  });
}

export function getLatestOpenProposal(
  file: ProposalsFile,
): ProposalEntry | undefined {
  return getOpenProposalsSortedByRecency(file)[0];
}

export function getBlockingOpenProposalsSortedByRecency(
  file: ProposalsFile,
): ProposalEntry[] {
  return getOpenProposalsSortedByRecency(file).filter(
    (proposal) => !proposal.auto_resolvable,
  );
}

export function getLatestBlockingOpenProposal(
  file: ProposalsFile,
): ProposalEntry | undefined {
  return getBlockingOpenProposalsSortedByRecency(file)[0];
}

export function countOpenNonAutoResolvableProposals(
  file: ProposalsFile,
): number {
  return file.proposals.filter(
    (proposal) => proposal.status === "open" && !proposal.auto_resolvable,
  ).length;
}

export function hasOpenNonAutoResolvableProposals(
  file: ProposalsFile,
): boolean {
  return countOpenNonAutoResolvableProposals(file) > 0;
}

export function resolveAutoResolvableProposals(
  file: ProposalsFile,
  resolvedBy: ProposalResolvedBy,
  resolvedAt: string,
): ProposalsFile {
  return {
    version: 1,
    proposals: file.proposals.map((proposal) =>
      proposal.status === "open" && proposal.auto_resolvable
        ? {
            ...proposal,
            status: "resolved",
            resolved_at: resolvedAt,
            resolved_by: resolvedBy,
          }
        : proposal,
    ),
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isProposalEntry(value: unknown): value is ProposalEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<ProposalEntry>;
  return (
    typeof entry.id === "string" &&
    (entry.source === "executor" ||
      entry.source === "auditor" ||
      entry.source === "todo_writer") &&
    typeof entry.cycle === "number" &&
    typeof entry.kind === "string" &&
    (entry.priority === "low" ||
      entry.priority === "medium" ||
      entry.priority === "high" ||
      entry.priority === "critical") &&
    typeof entry.summary === "string" &&
    isStringArray(entry.related_requirement_ids) &&
    isStringArray(entry.related_todo_ids) &&
    (entry.status === "open" ||
      entry.status === "resolved" ||
      entry.status === "dismissed") &&
    typeof entry.auto_resolvable === "boolean" &&
    typeof entry.created_at === "string" &&
    (entry.details === undefined || typeof entry.details === "string") &&
    (entry.resolved_at === undefined ||
      typeof entry.resolved_at === "string") &&
    (entry.resolved_by === undefined ||
      entry.resolved_by === "cli" ||
      entry.resolved_by === "planner" ||
      entry.resolved_by === "todo_writer" ||
      entry.resolved_by === "auto")
  );
}

export function loadProposals(filePath: string): ProposalsFile {
  if (!fs.existsSync(filePath)) {
    return { ...EMPTY_PROPOSALS_FILE };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { proposals?: unknown }).proposals) ||
      !((parsed as { proposals?: unknown }).proposals as unknown[]).every(
        isProposalEntry,
      )
    ) {
      return { ...EMPTY_PROPOSALS_FILE };
    }

    return parsed as ProposalsFile;
  } catch {
    return { ...EMPTY_PROPOSALS_FILE };
  }
}

export function saveProposals(filePath: string, data: ProposalsFile): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // Best-effort persistence: proposal writes must not abort the loop.
  }
}
