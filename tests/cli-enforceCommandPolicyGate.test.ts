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

  it("exits when command-policy.json is missing", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;

      try {
        expect(() => enforceCommandPolicyGate(dir)).toThrow(
          /process\.exit\(1\) called/,
        );
      } finally {
        (process as any).exit = originalExit;
      }
    });
  });

  it("exits when loop_status=needs_refinement", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;

      fs.writeFileSync(
        path.join(dir, "command-policy.json"),
        JSON.stringify({ summary: { loop_status: "needs_refinement" } }),
        "utf8",
      );

      try {
        expect(() => enforceCommandPolicyGate(dir)).toThrow(
          /process\.exit\(1\) called/,
        );
      } finally {
        (process as any).exit = originalExit;
      }
    });
  });

  it("exits when loop_status=blocked_by_environment", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;

      fs.writeFileSync(
        path.join(dir, "command-policy.json"),
        JSON.stringify({ summary: { loop_status: "blocked_by_environment" } }),
        "utf8",
      );

      try {
        expect(() => enforceCommandPolicyGate(dir)).toThrow(
          /process\.exit\(1\) called/,
        );
      } finally {
        (process as any).exit = originalExit;
      }
    });
  });

  it("exits when command-policy.json is invalid JSON", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;

      fs.writeFileSync(path.join(dir, "command-policy.json"), "{", "utf8");

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
