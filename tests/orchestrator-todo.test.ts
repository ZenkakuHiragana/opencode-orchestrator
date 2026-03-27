import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { getOrchestratorStateDir } from "../src/orchestrator-paths.js";
import {
  orchTodoReadTool,
  orchTodoWriteTool,
} from "../src/orchestrator-todo.js";

describe("orchTodoReadTool", () => {
  it("accepts legacy array-shaped todo.json files", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-todo-read-"));
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("array-shape");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify([
        {
          id: "T1",
          summary: "legacy todo",
          status: "pending",
          related_requirement_ids: ["R1"],
        },
      ]),
      "utf8",
    );

    const result = await orchTodoReadTool.execute({ task: "array-shape" }, {
      agent: "orch-executor",
    } as any);

    expect(JSON.parse(result)).toEqual({
      todos: [
        {
          id: "T1",
          summary: "legacy todo",
          status: "pending",
          related_requirement_ids: ["R1"],
        },
      ],
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("returns SPEC_ERROR when todo.json is corrupted", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-invalid-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("broken-shape");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "todo.json"), "not-json", "utf8");

    const result = await orchTodoReadTool.execute({ task: "broken-shape" }, {
      agent: "orch-executor",
    } as any);

    expect(JSON.parse(result)).toEqual({
      ok: false,
      error:
        "SPEC_ERROR: canonical todo cache is invalid: todo.json parse failed",
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("returns SPEC_ERROR when todo.json contains malformed entries", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-malformed-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("malformed-shape");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({ todos: [{}] }),
      "utf8",
    );

    const result = await orchTodoReadTool.execute({ task: "malformed-shape" }, {
      agent: "orch-executor",
    } as any);

    expect(JSON.parse(result)).toEqual({
      ok: false,
      error:
        "SPEC_ERROR: canonical todo cache is invalid: todo.json has invalid shape",
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("returns SPEC_ERROR when execution_contract has an invalid shape", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-bad-contract-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("bad-contract");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T1",
            summary: "invalid execution contract",
            status: "pending",
            related_requirement_ids: ["R3"],
            execution_contract: {
              expected_evidence: ["ok"],
              command_ids: "cmd-npm-test",
            },
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoReadTool.execute({ task: "bad-contract" }, {
      agent: "orch-executor",
    } as any);

    expect(JSON.parse(result)).toEqual({
      ok: false,
      error:
        "SPEC_ERROR: canonical todo cache is invalid: todo.json has invalid shape",
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });
});

describe("orchTodoWriteTool", () => {
  it("blocks incremental updates when todo.json is corrupted", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-write-invalid-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("broken-write");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "todo.json"), "{", "utf8");

    const result = await orchTodoWriteTool.execute(
      {
        task: "broken-write",
        mode: "executor_update_statuses",
        statusUpdates: [{ id: "T1", status: "completed" }],
      },
      { agent: "orch-executor" } as any,
    );

    expect(JSON.parse(result)).toEqual({
      ok: false,
      error:
        "SPEC_ERROR: canonical todo cache is invalid: todo.json parse failed. Use planner_replace_canonical to regenerate it.",
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("generates stable protocol-safe ids for planner_add_todos", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-todo-add-"));
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("add-shape");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({ todos: [] }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "add-shape",
        mode: "planner_add_todos",
        addTodos: [
          {
            summary: "Prepare task documentation",
            status: "pending",
            related_requirement_ids: ["R1-docs"],
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    expect(JSON.parse(result)).toEqual({
      ok: true,
      addedIds: ["T1-r1-docs-prepare-task-documentation"],
    });

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as { todos: Array<{ id: string }> };
    expect(saved.todos[0]?.id).toBe("T1-r1-docs-prepare-task-documentation");

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("updates existing todos based on planner_update_todos filters and patches", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-todo-update-"));
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("update-shape");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T1-sample-survey",
            summary: "old summary",
            status: "pending",
            related_requirement_ids: ["R1"],
          },
          {
            id: "T18-sample-secondary",
            summary: "connection status overview",
            status: "in_progress",
            related_requirement_ids: ["R1", "R2"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "update-shape",
        mode: "planner_update_todos",
        updates: [
          {
            filter: {
              id: "T1-sample-survey",
              related_requirement_ids: ["R1"],
            },
            patch: {
              summary: "new summary",
              execution_contract: {
                intent: "investigate",
                expected_evidence: ["e1"],
              },
            },
          },
          {
            filter: {
              related_requirement_ids: ["R1", "R2"],
              status: "in_progress",
            },
            patch: {
              status: "pending",
            },
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    const parsed = JSON.parse(result) as {
      ok: boolean;
      updatedIds?: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.updatedIds).toEqual([
      "T1-sample-survey",
      "T18-sample-secondary",
    ]);

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as {
      todos: Array<{
        id: string;
        summary: string;
        status: string;
        related_requirement_ids: string[];
        execution_contract?: { intent?: string; expected_evidence?: string[] };
      }>;
    };

    const t1 = saved.todos.find((t) => t.id === "T1-sample-survey");
    const t18 = saved.todos.find((t) => t.id === "T18-sample-secondary");

    expect(t1?.summary).toBe("new summary");
    expect(t1?.execution_contract).toEqual({
      intent: "investigate",
      expected_evidence: ["e1"],
    });

    expect(t18?.status).toBe("pending");

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("combines filter fields with AND and values within a field with OR", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-update-combo-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("update-combo");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T10-a",
            summary: "todo A",
            status: "pending",
            related_requirement_ids: ["R1", "R2"],
          },
          {
            id: "T10-b",
            summary: "todo B",
            status: "pending",
            related_requirement_ids: ["R2"],
          },
          {
            id: "T20-c",
            summary: "todo C",
            status: "completed",
            related_requirement_ids: ["R1"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "update-combo",
        mode: "planner_update_todos",
        updates: [
          {
            filter: {
              id: ["T10-a", "T10-b"],
              related_requirement_ids: ["R1", "R2"],
              status: "pending",
            },
            patch: {
              summary: "updated",
            },
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    const parsed = JSON.parse(result) as {
      ok: boolean;
      updatedIds?: string[];
    };
    expect(parsed.ok).toBe(true);
    // id / related_requirement_ids / status の AND 条件を満たす T10-a/T10-b が両方更新される
    expect(parsed.updatedIds).toEqual(["T10-a", "T10-b"]);

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as {
      todos: Array<{ id: string; summary: string }>;
    };

    const a = saved.todos.find((t) => t.id === "T10-a");
    const b = saved.todos.find((t) => t.id === "T10-b");
    const c = saved.todos.find((t) => t.id === "T20-c");

    expect(a?.summary).toBe("updated");
    expect(b?.summary).toBe("updated");
    expect(c?.summary).toBe("todo C");

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("returns SPEC_ERROR when planner_update_todos update has an empty filter", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-update-empty-filter-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("update-empty-filter");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T1",
            summary: "todo",
            status: "pending",
            related_requirement_ids: ["R1"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "update-empty-filter",
        mode: "planner_update_todos",
        updates: [
          {
            filter: {},
            patch: {
              summary: "new",
            },
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    const parsed = JSON.parse(result) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(
      "planner_update_todos update[0] has an empty filter",
    );

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("returns SPEC_ERROR when planner_update_todos update has an empty patch", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-update-empty-patch-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("update-empty-patch");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T1",
            summary: "todo",
            status: "pending",
            related_requirement_ids: ["R1"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "update-empty-patch",
        mode: "planner_update_todos",
        updates: [
          {
            filter: { id: "T1" },
            patch: {},
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    const parsed = JSON.parse(result) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(
      "planner_update_todos update[0] has an empty patch",
    );

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("returns SPEC_ERROR when planner_update_todos filter matches no todos", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-update-no-match-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("update-no-match");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T1",
            summary: "todo",
            status: "pending",
            related_requirement_ids: ["R1"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "update-no-match",
        mode: "planner_update_todos",
        updates: [
          {
            filter: { id: "T2" },
            patch: { summary: "new" },
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    const parsed = JSON.parse(result) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(
      "planner_update_todos filter at index 0 did not match any todos",
    );

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("filters by summary_contains and execution_contract_expected_evidence_contains", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-update-substring-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("update-substring");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T1",
            summary: "[WIP] 未調査の項目一覧",
            status: "pending",
            related_requirement_ids: ["R1"],
            execution_contract: {
              intent: "investigate",
              expected_evidence: ["今後自動投入", "代表例のみ (例示)"],
            },
          },
          {
            id: "T2",
            summary: "完成済みの項目一覧",
            status: "pending",
            related_requirement_ids: ["R1"],
            execution_contract: {
              intent: "investigate",
              expected_evidence: ["具体的な JSON"],
            },
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "update-substring",
        mode: "planner_update_todos",
        updates: [
          {
            filter: {
              summary_contains: "未調査",
              execution_contract_expected_evidence_contains: "今後自動投入",
            },
            patch: {
              summary: "プレースホルダを潰した項目一覧",
            },
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    const parsed = JSON.parse(result) as {
      ok: boolean;
      updatedIds?: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.updatedIds).toEqual(["T1"]);

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as { todos: Array<{ id: string; summary: string }> };
    const t1 = saved.todos.find((t) => t.id === "T1");
    const t2 = saved.todos.find((t) => t.id === "T2");

    expect(t1?.summary).toBe("プレースホルダを潰した項目一覧");
    expect(t2?.summary).toBe("完成済みの項目一覧");

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("preserves execution_contract metadata in planner_replace_canonical output", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-replace-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;

    const result = await orchTodoWriteTool.execute(
      {
        task: "replace-shape",
        mode: "planner_replace_canonical",
        canonicalTodos: [
          {
            id: "TW-004",
            summary: "Persist audit-ready execution contract fields",
            status: "pending",
            related_requirement_ids: ["R3-todo-bounded-decomposition"],
            execution_contract: {
              intent: "implement",
              expected_evidence: ["todo.json keeps expected proof strings"],
              command_ids: ["cmd-git-diff-file"],
              audit_ready_when: [
                "auditor can inspect proof boundary from state",
              ],
            },
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    expect(JSON.parse(result)).toEqual({ ok: true });

    const saved = JSON.parse(
      fs.readFileSync(
        path.join(getOrchestratorStateDir("replace-shape"), "todo.json"),
        "utf8",
      ),
    ) as {
      todos: Array<{
        execution_contract?: {
          intent?: string;
          expected_evidence?: string[];
          command_ids?: string[];
          audit_ready_when?: string[];
        };
      }>;
    };

    expect(saved.todos[0]?.execution_contract).toEqual({
      intent: "implement",
      expected_evidence: ["todo.json keeps expected proof strings"],
      command_ids: ["cmd-git-diff-file"],
      audit_ready_when: ["auditor can inspect proof boundary from state"],
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("preserves artifact_schema and artifact_filename in execution_contract", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-artifact-contract-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;

    const result = await orchTodoWriteTool.execute(
      {
        task: "artifact-contract",
        mode: "planner_replace_canonical",
        canonicalTodos: [
          {
            id: "T12-sample-survey",
            summary: "Investigate external interface details",
            status: "pending",
            related_requirement_ids: ["R1"],
            execution_contract: {
              intent: "investigate",
              artifact_schema: "investigation_v1",
              artifact_filename: "T12-sample-survey.json",
              expected_evidence: ["API coverage summary", "stability grouping"],
            },
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    expect(JSON.parse(result)).toEqual({ ok: true });

    const saved = JSON.parse(
      fs.readFileSync(
        path.join(getOrchestratorStateDir("artifact-contract"), "todo.json"),
        "utf8",
      ),
    ) as {
      todos: Array<{
        execution_contract?: {
          intent?: string;
          artifact_schema?: string;
          artifact_filename?: string;
        };
      }>;
    };

    expect(saved.todos[0]?.execution_contract).toEqual({
      intent: "investigate",
      artifact_schema: "investigation_v1",
      artifact_filename: "T12-sample-survey.json",
      expected_evidence: ["API coverage summary", "stability grouping"],
    });

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("records result_artifacts when status is completed", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-artifact-done-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("artifact-done");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T12-sample-investigation",
            summary: "Investigate external interface details",
            status: "in_progress",
            related_requirement_ids: ["R1"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "artifact-done",
        mode: "executor_update_statuses",
        statusUpdates: [
          {
            id: "T12-sample-investigation",
            status: "completed",
            result_artifacts: [
              {
                kind: "investigation_v1",
                path: ".opencode/orchestrator/artifact-done/artifacts/T12-sample-investigation.json",
                summary:
                  "multiple usage locations and several risky dependency edges",
              },
            ],
          },
        ],
      },
      { agent: "orch-executor" } as any,
    );

    expect(JSON.parse(result)).toEqual({ ok: true });

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as {
      todos: Array<{
        status: string;
        result_artifacts?: Array<{
          kind: string;
          path: string;
          summary: string;
        }>;
      }>;
    };

    expect(saved.todos[0]?.status).toBe("completed");
    expect(saved.todos[0]?.result_artifacts).toEqual([
      {
        kind: "investigation_v1",
        path: ".opencode/orchestrator/artifact-done/artifacts/T12-sample-investigation.json",
        summary: "multiple usage locations and several risky dependency edges",
      },
    ]);

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("allows multiple result_artifacts in a single update", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-multi-artifact-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("multi-artifact");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T18-verify-config",
            summary: "Verify configuration loader",
            status: "in_progress",
            related_requirement_ids: ["R4"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "multi-artifact",
        mode: "executor_update_statuses",
        statusUpdates: [
          {
            id: "T18-verify-config",
            status: "completed",
            result_artifacts: [
              {
                kind: "verification_v1",
                path: ".opencode/orchestrator/multi-artifact/artifacts/T18-verify-1.json",
                summary: "Unit test results",
              },
              {
                kind: "verification_v1",
                path: ".opencode/orchestrator/multi-artifact/artifacts/T18-verify-2.json",
                summary: "Integration test results",
              },
            ],
          },
        ],
      },
      { agent: "orch-executor" } as any,
    );

    expect(JSON.parse(result)).toEqual({ ok: true });

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as {
      todos: Array<{
        result_artifacts?: Array<{ kind: string }>;
      }>;
    };

    expect(saved.todos[0]?.result_artifacts).toHaveLength(2);

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("rejects result_artifacts when status is not completed", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-artifact-reject-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("artifact-reject");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T12-sample-investigation",
            summary: "Investigate public API surface",
            status: "pending",
            related_requirement_ids: ["R1"],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "artifact-reject",
        mode: "executor_update_statuses",
        statusUpdates: [
          {
            id: "T12-sample-investigation",
            status: "in_progress",
            result_artifacts: [
              {
                kind: "investigation_v1",
                path: ".opencode/orchestrator/artifact-reject/artifacts/T12-sample-investigation.json",
                summary: "partial results",
              },
            ],
          },
        ],
      },
      { agent: "orch-executor" } as any,
    );

    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(
      "result_artifacts may only be recorded when status is 'completed'",
    );
    expect(parsed.error).toContain("T12-sample-investigation");
    expect(parsed.error).toContain("in_progress");

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });

  it("appends result_artifacts to existing artifacts", async () => {
    const baseDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-todo-artifact-append-"),
    );
    const previousXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = baseDir;
    const stateDir = getOrchestratorStateDir("artifact-append");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "todo.json"),
      JSON.stringify({
        todos: [
          {
            id: "T12-sample-investigation",
            summary: "Investigate public API surface",
            status: "in_progress",
            related_requirement_ids: ["R1"],
            result_artifacts: [
              {
                kind: "investigation_v1",
                path: ".opencode/orchestrator/artifact-append/artifacts/T12-sample-phase1.json",
                summary: "Phase 1 results",
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    const result = await orchTodoWriteTool.execute(
      {
        task: "artifact-append",
        mode: "executor_update_statuses",
        statusUpdates: [
          {
            id: "T12-sample-investigation",
            status: "completed",
            result_artifacts: [
              {
                kind: "investigation_v1",
                path: ".opencode/orchestrator/artifact-append/artifacts/T12-sample-phase2.json",
                summary: "Phase 2 results",
              },
            ],
          },
        ],
      },
      { agent: "orch-executor" } as any,
    );

    expect(JSON.parse(result)).toEqual({ ok: true });

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as {
      todos: Array<{
        result_artifacts?: Array<{ path: string }>;
      }>;
    };

    expect(saved.todos[0]?.result_artifacts).toHaveLength(2);
    expect(saved.todos[0]?.result_artifacts?.[0]?.path).toBe(
      ".opencode/orchestrator/artifact-append/artifacts/T12-sample-phase1.json",
    );
    expect(saved.todos[0]?.result_artifacts?.[1]?.path).toBe(
      ".opencode/orchestrator/artifact-append/artifacts/T12-sample-phase2.json",
    );

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });
});
