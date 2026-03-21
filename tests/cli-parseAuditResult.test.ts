import { describe, it, expect } from "vitest";
import { parseAuditResult } from "../src/cli.js";

describe("parseAuditResult", () => {
  it("returns defaults when no JSON text is found", () => {
    const out = parseAuditResult("plain text only");
    expect(out.done).toBe(false);
    expect(out.requirementsJson).toBeNull();
    expect(out.failed).toEqual([]);
    expect(out.passed).toEqual([]);
  });

  it("parses last JSON text event and summarizes requirements", () => {
    const payload = {
      done: true,
      requirements: [
        { id: "R1", passed: true },
        { id: "R2", passed: false, reason: "not finished" },
      ],
    };

    const stream = [
      JSON.stringify({
        type: "event",
        part: { type: "text", text: "ignored" },
      }),
      JSON.stringify({
        type: "event",
        part: { type: "text", text: JSON.stringify(payload) },
      }),
    ].join("\n");

    const out = parseAuditResult(stream);
    expect(out.done).toBe(true);
    expect(out.requirementsJson).toBe(
      JSON.stringify([
        { id: "R1", passed: true },
        { id: "R2", passed: false },
      ]),
    );
    expect(out.passed).toEqual(["R1"]);
    expect(out.failed).toEqual([{ id: "R2", reason: "not finished" }]);
  });
});
