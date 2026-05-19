import * as fs from "node:fs";

import type { LoopOptions } from "./cli-args.js";
import { t } from "./i18n/messages.js";
import {
  parseAuditResult,
  type AuditMode,
  type AuditSummary,
} from "./orchestrator-audit.js";
import { runOpencode } from "./orchestrator-process.js";
import { buildAuditPrompt, withTaskKeyHint } from "./orchestrator-prompts.js";
import type { AuditorPassResult } from "./orchestrator-step-types.js";
import type {
  AuditorReportSnapshot,
  AuditorRequirementSnapshot,
} from "./orchestrator-status.js";
import { detectExecutorOpencodeInfraError } from "./orchestrator-step-recovery.js";

export function normalizeRequirementIds(ids: string[]): string[] {
  return Array.from(
    new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
}

export function loadAcceptanceRequirementIds(stateDir: string): string[] {
  const acceptanceIndexPath = `${stateDir}/acceptance-index.json`;
  if (!fs.existsSync(acceptanceIndexPath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(acceptanceIndexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      requirements?: { id?: unknown }[];
    };
    if (!Array.isArray(parsed.requirements)) {
      return [];
    }
    return normalizeRequirementIds(
      parsed.requirements
        .map((requirement) =>
          typeof requirement?.id === "string" ? requirement.id : "",
        )
        .filter((id) => id.length > 0),
    );
  } catch {
    return [];
  }
}

function buildAuditorReport(
  step: number,
  auditMode: AuditMode,
  scopeRequirementIds: string[],
  done: boolean,
  failed: AuditSummary["failed"],
  passed: string[],
): AuditorReportSnapshot {
  return {
    cycle: step,
    audit_mode: auditMode,
    scope_requirement_ids: normalizeRequirementIds(scopeRequirementIds),
    done,
    requirements: failed
      .map<AuditorRequirementSnapshot>((requirement) => ({
        id: requirement.id,
        passed: false,
        reason: requirement.reason,
        failure_kind: requirement.failure_kind,
        evidence_gaps: requirement.evidence_gaps,
      }))
      .concat(
        passed.map<AuditorRequirementSnapshot>((id) => ({
          id,
          passed: true,
        })),
      ),
  };
}

async function cleanupAuditorSession(
  sessionId: string | null,
  auditTitle: string,
  findSessionIdByTitle: (title: string) => Promise<string | null>,
): Promise<void> {
  let resolvedSessionId = sessionId;
  if (!resolvedSessionId) {
    try {
      resolvedSessionId = await findSessionIdByTitle(auditTitle);
    } catch {
      resolvedSessionId = null;
    }
  }

  if (!resolvedSessionId) {
    return;
  }

  try {
    await runOpencode(
      ["session", "delete", resolvedSessionId],
      undefined,
      false,
    );
  } catch {
    // Cleanup failure is non-fatal.
  }
}

export async function runAuditorPass(
  opts: LoopOptions,
  step: number,
  fileArgs: string[],
  auditRaw: string,
  auditMode: AuditMode,
  scopeRequirementIds: string[],
  findSessionIdByTitle: (title: string) => Promise<string | null>,
): Promise<AuditorPassResult> {
  const normalizedScopeRequirementIds =
    normalizeRequirementIds(scopeRequirementIds);
  const auditPromptBase = buildAuditPrompt(
    opts.prompt,
    opts.task,
    auditMode,
    normalizedScopeRequirementIds,
  );
  const auditPrompt = withTaskKeyHint(auditPromptBase, opts.task);
  const auditTitle =
    `orchestrator-audit ${opts.task} step=${step} mode=${auditMode} ` +
    `${new Date().toISOString()}`;
  const maxAuditAttempts = Math.max(1, opts.maxRestarts);

  let summary: AuditSummary = {
    done: false,
    requirementsJson: null,
    failed: [],
    passed: [],
    parseError: null,
  };
  let auditorSessionId: string | null = null;
  let attemptsInCurrentSession = 0;

  for (let attempt = 1; attempt <= maxAuditAttempts; attempt += 1) {
    const canReuseSession =
      auditorSessionId !== null &&
      attemptsInCurrentSession > 0 &&
      attemptsInCurrentSession < 3;
    const useExistingSession = canReuseSession;
    const args: string[] = useExistingSession
      ? [
          "run",
          "--session",
          auditorSessionId as string,
          ...fileArgs,
          "--",
          auditPrompt,
        ]
      : [
          "run",
          "--command",
          "orch-audit",
          "--title",
          auditTitle,
          "--format",
          "json",
          ...fileArgs,
          "--",
          auditPrompt,
        ];

    const auditRes = await runOpencode(args, auditRaw, false);
    const auditInfraError = detectExecutorOpencodeInfraError(
      auditRes.stdout,
      auditRes.stderr,
      auditRes.code,
    );
    if (auditInfraError) {
      console.error(
        `[opencode-orchestrator] auditor 実行中に OpenCode 実行エラーが発生しました: ${auditInfraError.message}`,
      );
    }

    const auditSafety = auditRes.stdout.includes(
      "I'm sorry, but I cannot assist with that request.",
    );
    summary = parseAuditResult(auditRes.stdout);

    if (useExistingSession) {
      attemptsInCurrentSession += 1;
    } else {
      attemptsInCurrentSession = 1;
    }

    const shouldRetry =
      attempt < maxAuditAttempts && (auditSafety || !!summary.parseError);

    if (shouldRetry && !useExistingSession) {
      try {
        auditorSessionId = await findSessionIdByTitle(auditTitle);
      } catch {
        auditorSessionId = null;
      }
    }

    if (!shouldRetry) {
      if (auditSafety) {
        console.error(
          "[opencode-orchestrator] auditor の出力で safety trip を検出しました。この監査パスは done=false として扱います。",
        );
      }
      break;
    }

    console.error(
      `[opencode-orchestrator] auditor の出力が契約どおりではありませんでした (attempt=${attempt}/${maxAuditAttempts - 1})。この監査パス内で再試行します。`,
    );
  }

  const effectiveScopeRequirementIds =
    summary.scopeRequirementIds && summary.scopeRequirementIds.length > 0
      ? normalizeRequirementIds(summary.scopeRequirementIds)
      : normalizedScopeRequirementIds;
  const done = auditMode === "final_full" ? summary.done : false;
  const report = buildAuditorReport(
    step,
    auditMode,
    effectiveScopeRequirementIds,
    done,
    summary.failed,
    summary.passed,
  );

  await cleanupAuditorSession(
    auditorSessionId,
    auditTitle,
    findSessionIdByTitle,
  );

  return {
    done,
    failed: summary.failed,
    passed: summary.passed,
    parseError: summary.parseError ?? null,
    report,
  };
}
