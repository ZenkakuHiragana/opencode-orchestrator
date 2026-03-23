export interface AuditSummary {
  done: boolean;
  requirementsJson: string | null;
  failed: { id: string; reason?: string }[];
  passed: string[];
  parseError?: string | null;
}

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
      "[opencode-orchestrator] ERROR: auditor produced no valid JSON output",
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
      requirements?: { id?: string; passed?: boolean; reason?: string }[];
    };

    // Check for the bug: done: false with empty requirements
    const hasRequirements =
      Array.isArray(payload.requirements) && payload.requirements.length > 0;
    if (payload.done === false && !hasRequirements) {
      const reason =
        "auditor returned done:false without any requirements (empty or missing requirements array)";
      console.error(
        "[opencode-orchestrator] ERROR: auditor returned done:false with empty requirements - treating as error",
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
    const failed: { id: string; reason?: string }[] = [];
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
          failed.push({ id: r.id, reason });
        }
      }
      requirementsJson = JSON.stringify(stripped);
    }

    const doneFlag = !!payload && payload.done === true;
    return { done: doneFlag, requirementsJson, failed, passed };
  } catch {
    const reason =
      "auditor produced invalid JSON when parsing the audit report";
    return {
      done: false,
      requirementsJson: null,
      failed: [],
      passed: [],
      parseError: reason,
    };
  }
}
