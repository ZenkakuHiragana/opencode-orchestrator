export interface AuditSummary {
  done: boolean;
  requirementsJson: string | null;
  failed: { id: string; reason?: string }[];
  passed: string[];
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
    // Auditor did not produce any valid JSON output - this is an error condition
    // Log for debugging purposes
    console.error(
      "[opencode-orchestrator] ERROR: auditor produced no valid JSON output",
    );
    return { done: false, requirementsJson: null, failed: [], passed: [] };
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
      console.error(
        "[opencode-orchestrator] ERROR: auditor returned done:false with empty requirements - treating as error",
      );
      return { done: false, requirementsJson: null, failed: [], passed: [] };
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
    return { done: false, requirementsJson: null, failed: [], passed: [] };
  }
}
