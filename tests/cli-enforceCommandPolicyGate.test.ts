import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { enforceCommandPolicyGate } from "../src/cli.js";

function withTempDir(fn: (dir: string) => void) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
  try {
    fn(base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

describe("enforceCommandPolicyGate", () => {
  it("allows loop when status is ready_for_loop and commands are available", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;
      const policy = {
        summary: { loop_status: "ready_for_loop" },
        commands: [
          {
            command: "npm test",
            usage: "must_exec",
            availability: "available",
          },
        ],
      };
      const file = path.join(dir, "command-policy.json");
      fs.writeFileSync(file, JSON.stringify(policy), "utf8");

      try {
        // Should not throw
        enforceCommandPolicyGate(dir);
      } finally {
        (process as any).exit = originalExit;
      }
    });
  });

  it("throws (via process.exit) when a must_exec command is unavailable", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;
      const policy = {
        summary: { loop_status: "ready_for_loop" },
        commands: [
          {
            command: "npm test",
            usage: "must_exec",
            availability: "unavailable",
          },
        ],
      };
      const file = path.join(dir, "command-policy.json");
      fs.writeFileSync(file, JSON.stringify(policy), "utf8");

      try {
        expect(() => enforceCommandPolicyGate(dir)).toThrow(
          /process\.exit\(1\) called/,
        );
      } finally {
        (process as any).exit = originalExit;
      }
    });
  });
});
