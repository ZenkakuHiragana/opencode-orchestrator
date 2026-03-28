import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";
import { orchTodoWriteTool } from "../src/orchestrator-todo.js";
import {
  loadProposals,
  saveProposals,
  type ProposalsFile,
} from "../src/orchestrator-proposals.js";

describe("loadProposals", () => {
  it("returns the default empty structure for missing, malformed, and wrong-version files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-proposals-"));

    expect(loadProposals(path.join(tmpDir, "missing.json"))).toEqual({
      version: 1,
      proposals: [],
    });

    const malformedPath = path.join(tmpDir, "malformed.json");
    fs.writeFileSync(malformedPath, "not-json", "utf8");
    expect(loadProposals(malformedPath)).toEqual({
      version: 1,
      proposals: [],
    });

    const wrongVersionPath = path.join(tmpDir, "wrong-version.json");
    fs.writeFileSync(
      wrongVersionPath,
      JSON.stringify({ version: 2, proposals: [] }),
      "utf8",
    );
    expect(loadProposals(wrongVersionPath)).toEqual({
      version: 1,
      proposals: [],
    });
  });

  it("returns parsed proposals when the file is valid", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-proposals-"));
    const filePath = path.join(tmpDir, "proposals.json");
    const file: ProposalsFile = {
      version: 1,
      proposals: [
        {
          id: "p-1",
          source: "executor",
          cycle: 4,
          kind: "need_replan",
          priority: "high",
          summary: "Need to replan the task slice",
          details: "details",
          related_requirement_ids: ["R1"],
          related_todo_ids: ["T1"],
          status: "open",
          auto_resolvable: true,
          created_at: "2026-03-29T00:00:00.000Z",
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(file), "utf8");

    expect(loadProposals(filePath)).toEqual(file);
  });
});

describe("saveProposals", () => {
  it("creates the parent directory and writes valid JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-proposals-"));
    const filePath = path.join(tmpDir, "nested", "proposals.json");
    const file: ProposalsFile = {
      version: 1,
      proposals: [],
    };

    saveProposals(filePath, file);

    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).toContain('\n  "version": 1,');
    expect(JSON.parse(raw)).toEqual(file);
  });

  it("is best-effort when writes fail", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-proposals-"));
    const filePath = tmpDir;

    expect(() =>
      saveProposals(filePath, { version: 1, proposals: [] }),
    ).not.toThrow();
    expect(fs.statSync(filePath).isDirectory()).toBe(true);
  });

  it("round-trips data through save then load", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-proposals-"));
    const filePath = path.join(tmpDir, "proposals.json");
    const file: ProposalsFile = {
      version: 1,
      proposals: [
        {
          id: "p-2",
          source: "todo_writer",
          cycle: 9,
          kind: "scope_change",
          priority: "medium",
          summary: "Scope changed",
          related_requirement_ids: ["R2"],
          related_todo_ids: ["T2"],
          status: "resolved",
          auto_resolvable: true,
          created_at: "2026-03-29T00:00:00.000Z",
          resolved_at: "2026-03-29T01:00:00.000Z",
          resolved_by: "auto",
        },
      ],
    };

    saveProposals(filePath, file);
    expect(loadProposals(filePath)).toEqual(file);
  });
});

describe("proposal enqueue path", () => {
  it("persists Todo-Writer proposals directly into proposals.json", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-proposals-"));
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("proposal-enqueue");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "status.json"),
      JSON.stringify({ version: 1, current_cycle: 7 }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "proposal-enqueue",
        mode: "planner_add_proposals",
        addProposals: [
          {
            kind: "need_replan",
            priority: "high",
            summary: "todo-writer から直接 proposal を追加する",
            related_requirement_ids: ["R3"],
            related_todo_ids: ["T3"],
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    const parsed = JSON.parse(result) as { ok: boolean; addedIds: string[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.addedIds).toHaveLength(1);
    expect(parsed.addedIds[0]).toMatch(/^p-/);

    const saved = loadProposals(path.join(stateDir, "proposals.json"));
    expect(saved.proposals).toHaveLength(1);
    expect(saved.proposals[0]).toMatchObject({
      source: "todo_writer",
      cycle: 7,
      kind: "need_replan",
      priority: "high",
      summary: "todo-writer から直接 proposal を追加する",
      related_requirement_ids: ["R3"],
      related_todo_ids: ["T3"],
      status: "open",
      auto_resolvable: true,
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });
});
