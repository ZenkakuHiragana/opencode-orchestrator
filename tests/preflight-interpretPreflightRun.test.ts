import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  buildOpencodeSpawnPlan,
  interpretPreflightRun,
  type CommandDescriptor,
  type OpencodeRunResult,
} from "../src/preflight-cli.js";

describe("buildOpencodeSpawnPlan", () => {
  it("uses node script directly on Windows when opencode script path is known", () => {
    const scriptPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "opencode-preflight-")),
      "opencode",
    );
    fs.writeFileSync(scriptPath, "#!/usr/bin/env node\n", "utf8");

    const plan = buildOpencodeSpawnPlan(
      scriptPath,
      [
        "run",
        "--format",
        "json",
        "--command",
        "orch-preflight",
        "--title",
        "test --help:mn1rbwla:7w4czfjf",
        "--dir",
        "D:\\repo",
        '[{"id":"cmd-npm-test","command":"npm test -- --help"}]',
      ],
      "win32",
    );

    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toEqual([
      scriptPath,
      "run",
      "--format",
      "json",
      "--command",
      "orch-preflight",
      "--title",
      "test --help:mn1rbwla:7w4czfjf",
      "--dir",
      "D:\\repo",
      '[{"id":"cmd-npm-test","command":"npm test -- --help"}]',
    ]);
    expect(plan.shell).toBe(false);
    expect(plan.windowsVerbatimArguments).toBeUndefined();
  });

  it("falls back to cmd.exe wrapping on Windows when script path is unknown", () => {
    const plan = buildOpencodeSpawnPlan(
      "C:\\missing\\opencode.cmd",
      ["run", "--help"],
      "win32",
      "C:\\Windows\\System32\\cmd.exe",
    );

    expect(plan).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "C:\\missing\\opencode.cmd", "run", "--help"],
      shell: false,
      windowsVerbatimArguments: true,
    });
  });

  it("avoids shell mode on non-Windows platforms", () => {
    const plan = buildOpencodeSpawnPlan("opencode", ["run", "--help"], "linux");

    expect(plan).toEqual({
      command: "opencode",
      args: ["run", "--help"],
      shell: false,
    });
  });
});

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
