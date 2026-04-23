export type AuditFailureKind =
  | "missing_implementation"
  | "incomplete_implementation"
  | "missing_verification"
  | "weak_evidence"
  | "missing_investigation"
  | "artifact_mismatch"
  | "scope_unclear";

export type AuditMode = "incremental" | "final_full";

export interface AuditSummary {
  done: boolean;
  requirementsJson: string | null;
  auditMode?: AuditMode;
  scopeRequirementIds?: string[];
  failed: {
    id: string;
    reason?: string;
    failure_kind?: AuditFailureKind;
    evidence_gaps?: string[];
  }[];
  passed: string[];
  parseError?: string | null;
}

const VALID_FAILURE_KINDS = new Set<string>([
  "missing_implementation",
  "incomplete_implementation",
  "missing_verification",
  "weak_evidence",
  "missing_investigation",
  "artifact_mismatch",
  "scope_unclear",
]);

export function parseAuditResult(stdout: string): AuditSummary {
  let lastText: string | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const anyEvent = event as { part?: { type?: string; text?: string } };
    const part = anyEvent.part || {};
    if (part.type === "text" && typeof part.text === "string") {
      lastText = part.text;
    }
  }

  if (!lastText) {
    const reason =
      "auditor produced no valid JSON output (non-JSON or empty response)";
    console.error(
      "[opencode-orchestrator] ERROR: auditor が有効な JSON 出力を生成しませんでした (JSON 以外、または空のレスポンス)",
    );
    return {
      done: false,
      requirementsJson: null,
      failed: [],
      passed: [],
      parseError: reason,
    };
  }

  try {
    const payload = JSON.parse(lastText) as {
      done?: boolean;
      audit_mode?: string;
      scope_requirement_ids?: unknown;
      requirements?: {
        id?: string;
        passed?: boolean;
        reason?: string;
        failure_kind?: string;
        evidence_gaps?: unknown;
      }[];
    };

    // Check for the bug: done: false with empty requirements
    const hasRequirements =
      Array.isArray(payload.requirements) && payload.requirements.length > 0;
    if (payload.done === false && !hasRequirements) {
      const reason =
        "auditor returned done:false without any requirements (empty or missing requirements array)";
      console.error(
        "[opencode-orchestrator] ERROR: auditor が done:false かつ requirements が空/欠落の結果を返しました (エラーとして扱います)",
      );
      return {
        done: false,
        requirementsJson: null,
        failed: [],
        passed: [],
        parseError: reason,
      };
    }

    let requirementsJson: string | null = null;
    const auditMode =
      payload.audit_mode === "incremental" ||
      payload.audit_mode === "final_full"
        ? payload.audit_mode
        : undefined;
    const scopeRequirementIds = Array.isArray(payload.scope_requirement_ids)
      ? payload.scope_requirement_ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : undefined;
    const failed: {
      id: string;
      reason?: string;
      failure_kind?: AuditFailureKind;
      evidence_gaps?: string[];
    }[] = [];
    const passed: string[] = [];

    if (payload && Array.isArray(payload.requirements)) {
      const stripped: { id: string; passed: boolean }[] = [];
      for (const r of payload.requirements) {
        if (!r || typeof r.id !== "string") continue;
        const passedFlag = !!r.passed;
        stripped.push({ id: r.id, passed: passedFlag });
        if (passedFlag) {
          passed.push(r.id);
        } else {
          const reason = typeof r.reason === "string" ? r.reason : undefined;
          const rawKind =
            typeof r.failure_kind === "string" ? r.failure_kind : undefined;
          const failure_kind = VALID_FAILURE_KINDS.has(rawKind ?? "")
            ? (rawKind as AuditFailureKind)
            : undefined;
          const rawGaps = Array.isArray(r.evidence_gaps)
            ? (r.evidence_gaps as unknown[]).filter(
                (g): g is string => typeof g === "string" && g.length > 0,
              )
            : undefined;
          const evidence_gaps =
            rawGaps && rawGaps.length > 0 ? rawGaps : undefined;
          failed.push({ id: r.id, reason, failure_kind, evidence_gaps });
        }
      }
      requirementsJson = JSON.stringify(stripped);
    }

    const doneFlag = !!payload && payload.done === true;
    return {
      done: doneFlag,
      requirementsJson,
      auditMode,
      scopeRequirementIds,
      failed,
      passed,
    };
  } catch {
    const reason =
      "auditor produced invalid JSON when parsing the audit report";
    return {
      done: false,
      requirementsJson: null,
      auditMode: undefined,
      scopeRequirementIds: undefined,
      failed: [],
      passed: [],
      parseError: reason,
    };
  }
}
