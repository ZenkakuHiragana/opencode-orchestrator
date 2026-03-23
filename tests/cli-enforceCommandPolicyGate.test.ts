import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { enforceCommandPolicyGate } from "../src/cli.js";

const helperAvailability = {
  "helper:grep": "available",
  "helper:rg": "available",
  "helper:sort": "available",
  "helper:sort-with-flags": "available",
  "helper:uniq": "available",
  "helper:uniq-with-flags": "available",
  "helper:wc": "available",
  "helper:head": "available",
  "helper:tail": "available",
  "helper:cut": "available",
  "helper:tr": "available",
  "helper:comm": "available",
  "helper:cat": "available",
  "helper:ls": "available",
  "helper:jq": "available",
  "helper:true": "available",
  "helper:false": "available",
  "helper:test": "available",
  "helper:bracket": "available",
} as const;

function makeCommandPolicyCommand(availability: "available" | "unavailable") {
  return {
    id: "cmd-npm-test",
    command: "npm test",
    role: "test",
    usage: "must_exec",
    availability,
    related_requirements: [],
    probe_command: "npm test -- --help",
    parameters: {},
    usage_notes: "",
  };
}

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
        version: 1,
        summary: {
          loop_status: "ready_for_loop",
          helper_availability: helperAvailability,
        },
        commands: [makeCommandPolicyCommand("available")],
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
        version: 1,
        summary: {
          loop_status: "ready_for_loop",
          helper_availability: helperAvailability,
        },
        commands: [makeCommandPolicyCommand("unavailable")],
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
        JSON.stringify({
          version: 1,
          summary: {
            loop_status: "needs_refinement",
            helper_availability: helperAvailability,
          },
          commands: [],
        }),
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
        JSON.stringify({
          version: 1,
          summary: {
            loop_status: "blocked_by_environment",
            helper_availability: helperAvailability,
          },
          commands: [],
        }),
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

  it("exits when summary.helper_availability is missing", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;

      fs.writeFileSync(
        path.join(dir, "command-policy.json"),
        JSON.stringify({
          version: 1,
          summary: { loop_status: "ready_for_loop" },
          commands: [],
        }),
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

  it("exits when a command entry is missing required fields", () => {
    withTempDir((dir) => {
      const originalExit = process.exit;
      (process as any).exit = ((code?: number) => {
        const err = new Error(`process.exit(${code ?? 0}) called`);
        (err as any).code = code ?? 0;
        throw err;
      }) as never;

      fs.writeFileSync(
        path.join(dir, "command-policy.json"),
        JSON.stringify({
          version: 1,
          summary: {
            loop_status: "ready_for_loop",
            helper_availability: helperAvailability,
          },
          commands: [
            {
              id: "cmd-npm-test",
              command: "npm test",
              role: "test",
              usage: "must_exec",
              availability: "available",
            },
          ],
        }),
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
});
