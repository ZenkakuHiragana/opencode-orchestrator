import { tool } from "@opencode-ai/plugin/tool";
import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";

const z = tool.schema;

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type CanonicalTodo = {
  id: string;
  summary: string;
  status: TodoStatus;
  related_requirement_ids: string[];
};

type CanonicalTodoFile = {
  todos: CanonicalTodo[];
};

function loadCanonicalTodos(task: string): {
  todos: CanonicalTodo[];
  stateDir: string;
  todoPath: string;
} {
  const stateDir = getOrchestratorStateDir(task);
  const todoPath = path.join(stateDir, "todo.json");
  if (!fs.existsSync(todoPath)) {
    return { todos: [], stateDir, todoPath };
  }

  const raw = fs.readFileSync(todoPath, "utf8");
  try {
    const parsed = JSON.parse(raw) as CanonicalTodoFile;
    if (parsed && Array.isArray(parsed.todos)) {
      return { todos: parsed.todos, stateDir, todoPath };
    }
  } catch {
    // fall through to treat as empty / corrupted file
  }
  return { todos: [], stateDir, todoPath };
}

function saveCanonicalTodos(todoPath: string, todos: CanonicalTodo[]): void {
  const fileObj: CanonicalTodoFile = { todos };
  const dir = path.dirname(todoPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(todoPath, JSON.stringify(fileObj, null, 2) + "\n", "utf8");
}

export const orchTodoReadTool = tool({
  description:
    "Read orchestrator todos for a given task with optional filtering. " +
    "This tool is intended for orch-todo-writer and orch-executor agents; other agents should avoid calling it.",
  args: {
    task: z
      .string()
      .describe(
        "Canonical orchestrator task key (for example `example-task`). Must match an existing orchestrator state directory.",
      ),
    filter: z
      .object({
        requirementIds: z
          .array(z.string())
          .min(1)
          .describe(
            "Limit results to todos whose related_requirement_ids intersect this list.",
          )
          .optional(),
        status: z
          .array(z.enum(["pending", "in_progress", "completed", "cancelled"]))
          .min(1)
          .describe("Limit results to todos with these statuses.")
          .optional(),
        ids: z
          .array(z.string())
          .min(1)
          .describe("Limit results to todos whose id is in this list.")
          .optional(),
        limit: z
          .number()
          .int()
          .positive()
          .describe(
            "Optional maximum number of todos to return after filtering.",
          )
          .optional(),
      })
      .optional(),
  },
  async execute(args, context) {
    const agentName = (context as any).agent as string | undefined;
    if (agentName !== "orch-todo-writer" && agentName !== "orch-executor") {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: orch_todo_read is reserved for orch-todo-writer and orch-executor agents.",
      });
    }

    const { todos } = loadCanonicalTodos(args.task);

    const filter = args.filter ?? {};
    let filtered = todos;

    if (filter.ids && filter.ids.length > 0) {
      const idSet = new Set(filter.ids);
      filtered = filtered.filter((t) => idSet.has(t.id));
    }

    if (filter.requirementIds && filter.requirementIds.length > 0) {
      const reqSet = new Set(filter.requirementIds);
      filtered = filtered.filter(
        (t) =>
          Array.isArray(t.related_requirement_ids) &&
          t.related_requirement_ids.some((rid) => reqSet.has(rid)),
      );
    }

    if (filter.status && filter.status.length > 0) {
      const statusSet = new Set(filter.status);
      filtered = filtered.filter((t) => statusSet.has(t.status));
    }

    if (filter.limit && filtered.length > filter.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return JSON.stringify({ todos: filtered });
  },
});

export const orchTodoWriteTool = tool({
  description:
    "Update orchestrator todos for a given task. " +
    "Use mode=planner_replace_canonical from orch-todo-writer to replace the canonical todo set, and " +
    "mode=executor_update_statuses from orch-executor to update statuses only. " +
    "When creating or replacing canonical todos (planner_replace_canonical / planner_add_todos), " +
    "new or adjusted todos should normally start with status 'pending'; reserve 'completed' / 'in_progress' / 'cancelled' " +
    "for cases where the underlying work is already known to be finished, currently in-flight, or explicitly not needed. " +
    "Misuse will return SPEC_ERROR.",
  args: {
    task: z
      .string()
      .describe(
        "Canonical orchestrator task key (for example `example-task`). Must match an existing orchestrator state directory.",
      ),
    mode: z
      .enum([
        "planner_replace_canonical",
        "planner_add_todos",
        "executor_update_statuses",
      ])
      .describe(
        "planner_replace_canonical: replace the canonical todo list (planner only). " +
          "planner_add_todos: append new todos with auto-assigned ids (planner only). " +
          "executor_update_statuses: update statuses for existing todos (executor only).",
      ),
    canonicalTodos: z
      .array(
        z.object({
          id: z.string(),
          summary: z.string(),
          // NOTE: Todo-Writer should normally use `pending` for new or adjusted todos
          // and reserve `completed` / `in_progress` / `cancelled` for cases where the
          // underlying work is already known to be finished or explicitly not needed.
          status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
          related_requirement_ids: z
            .array(z.string())
            .describe(
              "One or more requirement ids from acceptance-index.json covered by this todo.",
            ),
        }),
      )
      .describe(
        "Full canonical todo list to write when mode=planner_replace_canonical. This must include all todos for the task. " +
          "When introducing new todos or substantially changing existing ones, they should normally use status 'pending' " +
          "unless the underlying work is already known to be completed, in progress, or explicitly cancelled.",
      )
      .optional(),
    addTodos: z
      .array(
        z.object({
          summary: z.string(),
          status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
          related_requirement_ids: z
            .array(z.string())
            .describe(
              "One or more requirement ids from acceptance-index.json covered by this todo.",
            ),
        }),
      )
      .describe(
        "Todos to append when mode=planner_add_todos. Ids are auto-assigned based on the current todo count. " +
          "Newly added todos should normally use status 'pending' unless the work they describe is already known to be " +
          "completed, in progress, or explicitly cancelled.",
      )
      .optional(),
    statusUpdates: z
      .array(
        z.object({
          id: z.string().describe("Id of an existing canonical todo."),
          status: z
            .enum(["pending", "in_progress", "completed", "cancelled"])
            .describe("New status for this todo."),
        }),
      )
      .describe("Status updates to apply when mode=executor_update_statuses.")
      .optional(),
  },
  async execute(args, context) {
    const agentName = (context as any).agent as string | undefined;
    const { todos: existing, todoPath } = loadCanonicalTodos(args.task);

    if (args.mode === "planner_replace_canonical") {
      if (agentName !== "orch-todo-writer") {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: mode=planner_replace_canonical may only be used by orch-todo-writer.",
        });
      }
      if (!args.canonicalTodos) {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: mode=planner_replace_canonical requires canonicalTodos to be provided.",
        });
      }
      saveCanonicalTodos(todoPath, args.canonicalTodos);
      return JSON.stringify({ ok: true });
    }

    if (args.mode === "planner_add_todos") {
      if (agentName !== "orch-todo-writer") {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: mode=planner_add_todos may only be used by orch-todo-writer.",
        });
      }
      if (!args.addTodos || args.addTodos.length === 0) {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: mode=planner_add_todos requires non-empty addTodos array.",
        });
      }

      const existingIds = new Set(existing.map((t) => t.id));
      let counter = existing.length;
      const newTodos: CanonicalTodo[] = [];

      for (const t of args.addTodos) {
        let id: string;
        for (;;) {
          counter += 1;
          const candidate = `T${counter}-`;
          if (!existingIds.has(candidate)) {
            id = candidate;
            existingIds.add(candidate);
            break;
          }
        }

        newTodos.push({
          id,
          summary: t.summary,
          status: t.status,
          related_requirement_ids: t.related_requirement_ids,
        });
      }

      const updated = existing.concat(newTodos);
      saveCanonicalTodos(todoPath, updated);
      return JSON.stringify({ ok: true, addedIds: newTodos.map((t) => t.id) });
    }

    // executor_update_statuses
    if (agentName !== "orch-executor") {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: mode=executor_update_statuses may only be used by orch-executor.",
      });
    }
    if (!args.statusUpdates || args.statusUpdates.length === 0) {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: mode=executor_update_statuses requires non-empty statusUpdates array.",
      });
    }

    if (existing.length === 0) {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: executor_update_statuses cannot be used because no canonical todos exist yet. Run the planner first.",
      });
    }

    const byId = new Map<string, CanonicalTodo>();
    for (const t of existing) {
      byId.set(t.id, { ...t });
    }

    for (const upd of args.statusUpdates) {
      const target = byId.get(upd.id);
      if (!target) {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: executor_update_statuses referenced unknown todo id: " +
            upd.id,
        });
      }
      target.status = upd.status;
      byId.set(upd.id, target);
    }

    const updated = Array.from(byId.values());
    saveCanonicalTodos(todoPath, updated);
    return JSON.stringify({ ok: true });
  },
});
