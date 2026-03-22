import { tool } from "@opencode-ai/plugin/tool";
import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";

const z = tool.schema;

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type ResultArtifact = {
  kind: string;
  path: string;
  summary: string;
};

export type CanonicalTodoExecutionContract = {
  intent?: "implement" | "verify" | "investigate";
  expected_evidence?: string[];
  command_ids?: string[];
  audit_ready_when?: string[];
  artifact_schema?: string;
  artifact_filename?: string;
};

export type CanonicalTodo = {
  id: string;
  summary: string;
  status: TodoStatus;
  related_requirement_ids: string[];
  execution_contract?: CanonicalTodoExecutionContract;
  result_artifacts?: ResultArtifact[];
};

type CanonicalTodoFile = {
  todos: CanonicalTodo[];
};

function isCanonicalTodoExecutionContractLike(
  value: unknown,
): value is CanonicalTodoExecutionContract {
  if (value === undefined) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  const contract = value as {
    intent?: unknown;
    expected_evidence?: unknown;
    command_ids?: unknown;
    audit_ready_when?: unknown;
    artifact_schema?: unknown;
    artifact_filename?: unknown;
  };

  const isStringArray = (input: unknown): input is string[] =>
    Array.isArray(input) && input.every((item) => typeof item === "string");

  return (
    (contract.intent === undefined ||
      contract.intent === "implement" ||
      contract.intent === "verify" ||
      contract.intent === "investigate") &&
    (contract.expected_evidence === undefined ||
      isStringArray(contract.expected_evidence)) &&
    (contract.command_ids === undefined ||
      isStringArray(contract.command_ids)) &&
    (contract.audit_ready_when === undefined ||
      isStringArray(contract.audit_ready_when)) &&
    (contract.artifact_schema === undefined ||
      typeof contract.artifact_schema === "string") &&
    (contract.artifact_filename === undefined ||
      typeof contract.artifact_filename === "string")
  );
}

function loadCanonicalTodos(task: string): {
  todos: CanonicalTodo[];
  stateDir: string;
  todoPath: string;
  invalidReason?: string;
} {
  const stateDir = getOrchestratorStateDir(task);
  const todoPath = path.join(stateDir, "todo.json");
  if (!fs.existsSync(todoPath)) {
    return { todos: [], stateDir, todoPath };
  }

  const raw = fs.readFileSync(todoPath, "utf8");
  try {
    const parsed = JSON.parse(raw) as CanonicalTodoFile | CanonicalTodo[];
    if (Array.isArray(parsed) && parsed.every(isCanonicalTodoLike)) {
      return { todos: parsed, stateDir, todoPath };
    }
    if (
      parsed &&
      Array.isArray(parsed.todos) &&
      parsed.todos.every(isCanonicalTodoLike)
    ) {
      return { todos: parsed.todos, stateDir, todoPath };
    }
  } catch {
    return {
      todos: [],
      stateDir,
      todoPath,
      invalidReason: "todo.json parse failed",
    };
  }
  return {
    todos: [],
    stateDir,
    todoPath,
    invalidReason: "todo.json has invalid shape",
  };
}

function isCanonicalTodoLike(value: unknown): value is CanonicalTodo {
  if (!value || typeof value !== "object") {
    return false;
  }
  const todo = value as {
    id?: unknown;
    summary?: unknown;
    status?: unknown;
    related_requirement_ids?: unknown;
    execution_contract?: unknown;
    result_artifacts?: unknown;
  };

  const isResultArtifactLike = (input: unknown): input is ResultArtifact => {
    if (!input || typeof input !== "object") return false;
    const obj = input as { kind?: unknown; path?: unknown; summary?: unknown };
    return (
      typeof obj.kind === "string" &&
      typeof obj.path === "string" &&
      typeof obj.summary === "string"
    );
  };

  return (
    typeof todo.id === "string" &&
    typeof todo.summary === "string" &&
    (todo.status === "pending" ||
      todo.status === "in_progress" ||
      todo.status === "completed" ||
      todo.status === "cancelled") &&
    Array.isArray(todo.related_requirement_ids) &&
    todo.related_requirement_ids.every((rid) => typeof rid === "string") &&
    isCanonicalTodoExecutionContractLike(todo.execution_contract) &&
    (todo.result_artifacts === undefined ||
      (Array.isArray(todo.result_artifacts) &&
        todo.result_artifacts.every(isResultArtifactLike)))
  );
}

function saveCanonicalTodos(todoPath: string, todos: CanonicalTodo[]): void {
  const fileObj: CanonicalTodoFile = { todos };
  const dir = path.dirname(todoPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(todoPath, JSON.stringify(fileObj, null, 2) + "\n", "utf8");
}

function buildGeneratedTodoId(
  ordinal: number,
  summary: string,
  relatedRequirementIds: string[],
): string {
  const reqSlug = slugifyTodoPart(relatedRequirementIds[0] ?? "todo");
  const summarySlug = slugifyTodoPart(summary);
  return `T${ordinal}-${reqSlug || "todo"}-${summarySlug || "item"}`;
}

function slugifyTodoPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
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

    const { todos, invalidReason } = loadCanonicalTodos(args.task);
    if (invalidReason) {
      return JSON.stringify({
        ok: false,
        error: "SPEC_ERROR: canonical todo cache is invalid: " + invalidReason,
      });
    }

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
    "mode=executor_update_statuses from orch-executor to update statuses and record artifacts. " +
    "When creating or replacing canonical todos (planner_replace_canonical / planner_add_todos), " +
    "new or adjusted todos should normally start with status 'pending'; reserve 'completed' / 'in_progress' / 'cancelled' " +
    "for cases where the underlying work is already known to be finished, currently in-flight, or explicitly not needed. " +
    "\n\n" +
    "executor_update_statuses details:\n" +
    "- Each entry must have an 'id' and 'status'.\n" +
    "- 'result_artifacts' may only be provided when status is 'completed'. " +
    "If result_artifacts is provided with any other status, SPEC_ERROR is returned.\n" +
    "- result_artifacts is an array; you may record multiple artifacts in a single update.\n" +
    "- Each artifact requires 'kind' (schema version, e.g. investigation_v1), " +
    "'path' (full path under artifacts/), and 'summary' (one-line Japanese description).\n" +
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
          execution_contract: z
            .object({
              intent: z.enum(["implement", "verify", "investigate"]).optional(),
              expected_evidence: z.array(z.string()).optional(),
              command_ids: z.array(z.string()).optional(),
              audit_ready_when: z.array(z.string()).optional(),
              artifact_schema: z
                .string()
                .describe(
                  "Schema version for the artifact (e.g., investigation_v1, verification_v1).",
                )
                .optional(),
              artifact_filename: z
                .string()
                .describe(
                  "Filename under artifacts/ directory (e.g., T12-api-survey.json).",
                )
                .optional(),
            })
            .describe(
              "Optional executor-oriented handoff metadata: execution intent, expected evidence, relevant command ids, audit-ready conditions, and artifact specification.",
            )
            .optional(),
          result_artifacts: z
            .array(
              z.object({
                kind: z
                  .string()
                  .describe(
                    "Schema version of the artifact (e.g., investigation_v1).",
                  ),
                path: z.string().describe("Full path to the artifact file."),
                summary: z
                  .string()
                  .describe(
                    "One-line Japanese summary of the artifact contents.",
                  ),
              }),
            )
            .describe(
              "Artifacts produced by the Executor for this todo. Added after completion.",
            )
            .optional(),
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
          execution_contract: z
            .object({
              intent: z.enum(["implement", "verify", "investigate"]).optional(),
              expected_evidence: z.array(z.string()).optional(),
              command_ids: z.array(z.string()).optional(),
              audit_ready_when: z.array(z.string()).optional(),
              artifact_schema: z
                .string()
                .describe(
                  "Schema version for the artifact (e.g., investigation_v1, verification_v1).",
                )
                .optional(),
              artifact_filename: z
                .string()
                .describe(
                  "Filename under artifacts/ directory (e.g., T12-api-survey.json).",
                )
                .optional(),
            })
            .describe(
              "Optional executor-oriented handoff metadata: execution intent, expected evidence, relevant command ids, audit-ready conditions, and artifact specification.",
            )
            .optional(),
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
          result_artifacts: z
            .array(
              z.object({
                kind: z
                  .string()
                  .describe(
                    "Schema version of the artifact (e.g., investigation_v1).",
                  ),
                path: z.string().describe("Full path to the artifact file."),
                summary: z
                  .string()
                  .describe(
                    "One-line Japanese summary of the artifact contents.",
                  ),
              }),
            )
            .describe(
              "Artifacts produced by the Executor for this todo. Appended to existing artifacts.",
            )
            .optional(),
        }),
      )
      .describe(
        "Status and artifact updates to apply when mode=executor_update_statuses.",
      )
      .optional(),
  },
  async execute(args, context) {
    const agentName = (context as any).agent as string | undefined;
    const {
      todos: existing,
      todoPath,
      invalidReason,
    } = loadCanonicalTodos(args.task);

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

    if (invalidReason) {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: canonical todo cache is invalid: " +
          invalidReason +
          ". Use planner_replace_canonical to regenerate it.",
      });
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
          const candidate = buildGeneratedTodoId(
            counter,
            t.summary,
            t.related_requirement_ids,
          );
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
          execution_contract: t.execution_contract,
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
      if (
        upd.result_artifacts &&
        upd.result_artifacts.length > 0 &&
        upd.status !== "completed"
      ) {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: result_artifacts may only be recorded when status is 'completed'. " +
            "Todo " +
            upd.id +
            " has status '" +
            upd.status +
            "' but result_artifacts was provided.",
        });
      }
      target.status = upd.status;
      if (upd.result_artifacts && upd.result_artifacts.length > 0) {
        target.result_artifacts = [
          ...(target.result_artifacts ?? []),
          ...upd.result_artifacts,
        ];
      }
      byId.set(upd.id, target);
    }

    const updated = Array.from(byId.values());
    saveCanonicalTodos(todoPath, updated);
    return JSON.stringify({ ok: true });
  },
});
