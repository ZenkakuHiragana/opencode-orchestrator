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
