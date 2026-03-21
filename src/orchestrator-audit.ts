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
    return { done: false, requirementsJson: null, failed: [], passed: [] };
  }

  try {
    const payload = JSON.parse(lastText) as {
      done?: boolean;
      requirements?: { id?: string; passed?: boolean; reason?: string }[];
    };

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
