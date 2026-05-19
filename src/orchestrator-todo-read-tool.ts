import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";

import { loadCanonicalTodos } from "./orchestrator-todo-store.js";

const z = tool.schema;

export const orchTodoReadTool: ToolDefinition = tool({
  description:
    "Read orchestrator todos for a given task with optional filtering. " +
    "When no filter is provided, all canonical todos for the task are returned. " +
    "Wildcard values such as '*' are not supported in any filter field; values must match exactly. " +
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
            "Limit results to todos whose related_requirement_ids intersect this list. " +
              "When omitted, no filtering by related_requirement_ids is applied. " +
              "Wildcard values such as '*' are not treated specially; to read todos for all requirements, omit this field instead of passing ['*'].",
          )
          .optional(),
        status: z
          .array(z.enum(["pending", "in_progress", "completed", "cancelled"]))
          .min(1)
          .describe(
            "Limit results to todos with these statuses. " +
              "When omitted, todos with any status are included.",
          )
          .optional(),
        ids: z
          .array(z.string())
          .min(1)
          .describe(
            "Limit results to todos whose id is in this list. " +
              "When omitted, no filtering by id is applied. " +
              "Wildcard values such as '*' are not treated specially; to read all todos regardless of id, omit this field instead of passing ['*'].",
          )
          .optional(),
        limit: z
          .number()
          .int()
          .positive()
          .describe(
            "Optional maximum number of todos to return after filtering. " +
              "When omitted, all todos matching other filters are returned.",
          )
          .optional(),
      })
      .describe(
        "Optional filter to limit returned todos by ids, related_requirement_ids, and/or status. " +
          "When no filter is provided at all, all canonical todos for the task are returned. " +
          "Wildcard values such as '*' are not supported; values must match exactly.",
      )
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
    const hasWildcardInIds =
      Array.isArray(filter.ids) &&
      filter.ids.some((id) => typeof id === "string" && id.includes("*"));
    const hasWildcardInRequirementIds =
      Array.isArray(filter.requirementIds) &&
      filter.requirementIds.some(
        (rid) => typeof rid === "string" && rid.includes("*"),
      );

    if (hasWildcardInIds || hasWildcardInRequirementIds) {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: wildcard values such as '*' are not supported in ids/requirementIds; omit these fields to read all todos.",
      });
    }

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
