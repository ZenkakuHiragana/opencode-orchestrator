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
            summary: "Set up API endpoint docs",
            status: "pending",
            related_requirement_ids: ["R1-api-docs"],
          },
        ],
      },
      { agent: "orch-todo-writer" } as any,
    );

    expect(JSON.parse(result)).toEqual({
      ok: true,
      addedIds: ["T1-r1-api-docs-set-up-api-endpoint-docs"],
    });

    const saved = JSON.parse(
      fs.readFileSync(path.join(stateDir, "todo.json"), "utf8"),
    ) as { todos: Array<{ id: string }> };
    expect(saved.todos[0]?.id).toBe("T1-r1-api-docs-set-up-api-endpoint-docs");

    if (previousXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = previousXdgStateHome;
    }
  });
});
