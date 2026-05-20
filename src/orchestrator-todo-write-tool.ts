import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";

import { buildOrchTodoWriteArgs } from "./orchestrator-todo-write-schema.js";
import { executeOrchTodoWrite } from "./orchestrator-todo-write-execute.js";

const z = tool.schema;

export const orchTodoWriteTool: ToolDefinition = tool({
  description:
    "Update orchestrator todos for a given task.\n\n" +
    "This tool is used by two orchestrator agents:\n" +
    "- orch-todo-writer (planner) uses planner_* modes to design and evolve the canonical todo set.\n" +
    "- orch-executor uses executor_update_statuses to reflect execution progress.\n\n" +
    "Planner modes (orch-todo-writer only):\n" +
    "- mode=planner_replace_canonical: replace the entire canonical todo list for a task. Use this only when the todo structure must be regenerated from requirements/spec.\n" +
    "- mode=planner_add_todos: append new todos without changing any existing todos. Use this to add bridge work or new vertical slices.\n" +
    "- mode=planner_update_todos: patch specific fields (summary, related_requirement_ids, execution_contract, status) of existing todos selected via filters. " +
    "Filters combine fields with AND, treat multiple values within a field as OR, and support substring matches for summary and expected_evidence. " +
    "Empty filters/patches or filters that match no todos are rejected with SPEC_ERROR.\n\n" +
    "Executor mode (orch-executor only):\n" +
    "- mode=executor_update_statuses: update statuses and record result_artifacts for existing todos.\n" +
    "When creating or updating canonical todos (planner_replace_canonical / planner_add_todos / planner_update_todos), " +
    "new or adjusted todos should normally start with status 'pending'; reserve 'completed' / 'in_progress' / 'cancelled' " +
    "for cases where the underlying work is already known to be finished, currently in-flight, or explicitly not needed.\n\n" +
    "executor_update_statuses details:\n" +
    "- Each entry must have an 'id' and 'status'.\n" +
    "- 'result_artifacts' may only be provided when status is 'completed'. If result_artifacts is provided with any other status, SPEC_ERROR is returned.\n" +
    "- result_artifacts is an array; you may record multiple artifacts in a single update.\n" +
    "- Each artifact requires 'kind' (schema version, e.g. investigation_v1), 'path' (workspace-relative path under .opencode/orchestrator/<task-name>/artifacts/), and 'summary' (one-line English description).\n" +
    "Misuse will return SPEC_ERROR.",
  args: buildOrchTodoWriteArgs(z),
  async execute(args, context) {
    return executeOrchTodoWrite(args, context);
  },
});
