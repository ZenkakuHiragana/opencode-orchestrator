import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { runList } from "../src/orchestrator-list.js";

describe("runList --task --proposals", () => {
  const originalXdg = process.env.XDG_STATE_HOME;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  let prevLC_ALL: string | undefined;
  let prevLANG: string | undefined;

  beforeEach(() => {
    console.error = vi.fn();
    console.log = vi.fn();
    prevLC_ALL = process.env.LC_ALL;
    prevLANG = process.env.LANG;
    process.env.LC_ALL = "ja_JP.UTF-8";
    process.env.LANG = "ja_JP.UTF-8";
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    process.env.XDG_STATE_HOME = originalXdg;
    if (prevLC_ALL === undefined) {
      delete process.env.LC_ALL;
    } else {
      process.env.LC_ALL = prevLC_ALL;
    }
    if (prevLANG === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = prevLANG;
    }
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

    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-1",
              source: "executor",
              cycle: 2,
              kind: "env_blocked",
              priority: "critical",
              summary: "env blocked",
              details: "general: env_blocked: missing tool",
              related_requirement_ids: ["R8"],
              related_todo_ids: ["T1"],
              status: "open",
              auto_resolvable: false,
              created_at: "2026-03-29T00:00:00.000Z",
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
      `[opencode-orchestrator] タスク "${task}" の proposal 一覧:`,
    );
    expect(lines).toContain(
      "[executor] kind=env_blocked cycle=2 priority=critical status=open id=p-1",
    );
    expect(lines).toContain("summary: env blocked");
    expect(lines).toContain("details: general: env_blocked: missing tool");
  });

  it("filters to open proposals when --open is set", async () => {
    const fakeXdg = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-list-proposals-open-"),
    );
    process.env.XDG_STATE_HOME = fakeXdg;

    const baseDir = path.join(fakeXdg, "opencode", "orchestrator");
    const task = "my-task-proposals-open";
    const stateDir = path.join(baseDir, task, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-open",
              source: "executor",
              cycle: 2,
              kind: "need_replan",
              priority: "high",
              summary: "open proposal",
              details: "open details",
              related_requirement_ids: ["R7"],
              related_todo_ids: ["T7"],
              status: "open",
              auto_resolvable: true,
              created_at: "2026-03-29T00:00:00.000Z",
            },
            {
              id: "p-resolved",
              source: "auditor",
              cycle: 2,
              kind: "audit_failure",
              priority: "high",
              summary: "resolved proposal",
              details: "resolved details",
              related_requirement_ids: ["R19"],
              related_todo_ids: [],
              status: "resolved",
              auto_resolvable: true,
              created_at: "2026-03-29T00:00:00.000Z",
              resolved_at: "2026-03-29T01:00:00.000Z",
              resolved_by: "auto",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await runList({
      format: "text",
      task,
      showProposals: true,
      openOnly: true,
    });

    const errMock = console.error as unknown as {
      mock: { calls: unknown[][] };
    };
    const lines = errMock.mock.calls.map((c) => c.join(" ")).join("\n");

    expect(lines).toContain(
      "[executor] kind=need_replan cycle=2 priority=high status=open id=p-open",
    );
    expect(lines).not.toContain("p-resolved");
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

    fs.writeFileSync(
      path.join(stateDir, "proposals.json"),
      JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: "p-2",
              source: "auditor",
              cycle: 5,
              kind: "verification_gap",
              priority: "medium",
              summary: "verification check gap",
              details: "R1: missing verification evidence",
              related_requirement_ids: ["R1"],
              related_todo_ids: [],
              status: "open",
              auto_resolvable: true,
              created_at: "2026-03-29T00:00:00.000Z",
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
      version: 1;
      proposals: {
        id: string;
        kind: string;
        summary: string;
        priority: string;
      }[];
    };

    expect(payload.task).toBe(task);
    expect(Array.isArray(payload.proposals)).toBe(true);
    expect(payload.proposals[0].id).toBe("p-2");
    expect(payload.proposals[0].kind).toBe("verification_gap");
    expect(payload.proposals[0].summary).toBe("verification check gap");
    expect(payload.proposals[0].priority).toBe("medium");
  });
});
