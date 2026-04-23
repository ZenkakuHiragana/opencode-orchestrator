import { describe, expect, it } from "vitest";

import { parseAuditResult } from "../src/orchestrator-audit.js";

describe("parseAuditResult", () => {
  it("returns defaults when no JSON lines are present", () => {
    const res = parseAuditResult("just logs\nno json here");
    expect(res.done).toBe(false);
    expect(res.requirementsJson).toBeNull();
    expect(res.failed).toEqual([]);
    expect(res.passed).toEqual([]);
  });

  it("parses the last JSON text part into requirements", () => {
    const stdout = [
      "not json",
      JSON.stringify({ part: { type: "text", text: '{"done":false}' } }),
      JSON.stringify({
        part: {
          type: "text",
          text: JSON.stringify({
            audit_mode: "final_full",
            scope_requirement_ids: ["R1", "R2"],
            done: true,
            requirements: [
              { id: "R1", passed: true },
              { id: "R2", passed: false, reason: "missing tests" },
            ],
          }),
        },
      }),
    ].join("\n");

    const res = parseAuditResult(stdout);
    expect(res.done).toBe(true);
    expect(res.auditMode).toBe("final_full");
    expect(res.scopeRequirementIds).toEqual(["R1", "R2"]);
    expect(res.failed).toEqual([{ id: "R2", reason: "missing tests" }]);
    expect(res.passed).toEqual(["R1"]);

    expect(res.requirementsJson).not.toBeNull();
    const stripped = JSON.parse(res.requirementsJson as string) as {
      id: string;
      passed: boolean;
    }[];
    expect(stripped).toEqual([
      { id: "R1", passed: true },
      { id: "R2", passed: false },
    ]);
  });

  it("preserves structured failure metadata from auditor output", () => {
    const stdout = JSON.stringify({
      part: {
        type: "text",
        text: JSON.stringify({
          done: false,
          requirements: [
            {
              id: "R7",
              passed: false,
              reason: "No verification evidence exists for the API branch",
              failure_kind: "missing_verification",
              evidence_gaps: [
                "No test command output for the API branch",
                "No diff anchor tied to the API branch behavior",
              ],
            },
          ],
        }),
      },
    });

    const res = parseAuditResult(stdout);
    expect(res.done).toBe(false);
    expect(res.failed).toEqual([
      {
        id: "R7",
        reason: "No verification evidence exists for the API branch",
        failure_kind: "missing_verification",
        evidence_gaps: [
          "No test command output for the API branch",
          "No diff anchor tied to the API branch behavior",
        ],
      },
    ]);
  });

  it("tolerates malformed payload JSON", () => {
    const stdout = JSON.stringify({
      part: { type: "text", text: "not-json" },
    });
    const res = parseAuditResult(stdout);
    expect(res.done).toBe(false);
    expect(res.requirementsJson).toBeNull();
    expect(res.failed).toEqual([]);
    expect(res.passed).toEqual([]);
  });
});
