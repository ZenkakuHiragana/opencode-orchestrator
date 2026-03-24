import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { runList } from "../src/orchestrator-list.js";

describe("runList --task --proposals", () => {
  const originalXdg = process.env.XDG_STATE_HOME;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    console.error = vi.fn();
    console.log = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    process.env.XDG_STATE_HOME = originalXdg;
  });

  it("prints a formatted proposal list in text mode", async () => {
    const fakeXdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-list-proposals-text-"),
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const baseDir = path.join(fakeXdg, "opencode", "orchestrator");
    const task = "my-task-proposals-text";
    const stateDir = path.join(baseDir, task, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    const statusPath = path.join(stateDir, "status.json");
    fs.writeFileSync(
      statusPath,
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 2,
              kind: "env_blocked",
              summary: "env blocked",
              details: "general: env_blocked: missing tool",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await runList({ format: "text", task, showProposals: true });

    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => c.join(" ")).join("\n");

    expect(lines).toContain(
      `[opencode-orchestrator] proposals for task "${task}":`,
    );
    expect(lines).toContain("[executor] kind=env_blocked cycle=2 id=p-1");
    expect(lines).toContain("summary: env blocked");
    expect(lines).toContain("details: general: env_blocked: missing tool");
  });

  it("returns proposals as JSON when format=json", async () => {
    const fakeXdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-list-proposals-json-"),
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const baseDir = path.join(fakeXdg, "opencode", "orchestrator");
    const task = "my-task-proposals-json";
    const stateDir = path.join(baseDir, task, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    const statusPath = path.join(stateDir, "status.json");
    fs.writeFileSync(
      statusPath,
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-2",
              source: "auditor",
              cycle: 5,
              kind: "verification_gap",
              summary: "verification gap",
              details: "R1: missing verification evidence",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await runList({ format: "json", task, showProposals: true });

    const logMock = console.log as unknown as { mock: { calls: unknown[][] } };
    expect(logMock.mock.calls.length).toBeGreaterThan(0);
    const payload = JSON.parse(String(logMock.mock.calls[0][0])) as {
      task: string;
      proposals: { id: string; kind: string; summary: string }[];
    };

    expect(payload.task).toBe(task);
    expect(Array.isArray(payload.proposals)).toBe(true);
    expect(payload.proposals[0].id).toBe("p-2");
    expect(payload.proposals[0].kind).toBe("verification_gap");
    expect(payload.proposals[0].summary).toBe("verification gap");
  });
});
