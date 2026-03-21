import { describe, it, expect } from "vitest";

import {
  interpretPreflightRun,
  type CommandDescriptor,
  type OpencodeRunResult,
} from "../src/preflight-cli.js";

describe("interpretPreflightRun", () => {
  const descriptor: CommandDescriptor = {
    id: "cmd_npm_test",
    command: "npm test",
    role: "tests",
    usage: "must_exec",
  };

  it("treats opencode failure with no stdout as unavailable", () => {
    const runResult: OpencodeRunResult = {
      stdout: "",
      stderr: "some error",
      code: 1,
    };

    const { result, sessionID } = interpretPreflightRun(descriptor, runResult);
    expect(sessionID).toBeNull();
    expect(result.available).toBe(false);
    expect(result.exit_code).toBe(1);
    expect(result.command).toBe("npm test");
    expect(result.role).toBe("tests");
    expect(result.usage).toBe("must_exec");
    expect(result.stderr_excerpt).toContain("some error");
  });

  it("extracts JSON results when present", () => {
    const payload = {
      status: "ok",
      results: [
        {
          command: "npm test",
          role: "tests",
          usage: "must_exec" as const,
          available: true,
          exit_code: 0,
          stderr_excerpt: "",
        },
      ],
    };

    const eventLine = JSON.stringify({
      type: "text",
      part: { text: JSON.stringify(payload) },
      sessionID: "ses_123",
    });

    const runResult: OpencodeRunResult = {
      stdout: eventLine + "\n",
      stderr: "",
      code: 0,
    };

    const { result, sessionID } = interpretPreflightRun(descriptor, runResult);
    expect(sessionID).toBe("ses_123");
    expect(result.command).toBe("npm test");
    expect(result.role).toBe("tests");
    expect(result.usage).toBe("must_exec");
    expect(result.available).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.stderr_excerpt).toBe("");
  });

  it("falls back to tool_use error details when JSON is missing", () => {
    const lines = [
      JSON.stringify({
        type: "tool_use",
        part: {
          tool: "bash",
          state: {
            status: "error",
            input: { command: "npm test" },
            error: "permission denied",
          },
        },
      }),
    ].join("\n");

    const runResult: OpencodeRunResult = {
      stdout: lines + "\n",
      stderr: "",
      code: 0,
    };

    const { result, sessionID } = interpretPreflightRun(descriptor, runResult);
    expect(sessionID).toBeNull();
    expect(result.available).toBe(false);
    expect(result.stderr_excerpt).toContain(
      'preflight probe "npm test" failed',
    );
    expect(result.stderr_excerpt).toContain("permission denied");
  });
});
