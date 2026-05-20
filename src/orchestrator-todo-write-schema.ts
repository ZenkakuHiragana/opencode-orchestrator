import type { tool } from "@opencode-ai/plugin/tool";

export function buildOrchTodoWriteArgs(z: typeof tool.schema) {
  return {
    task: z
      .string()
      .describe(
        "Canonical orchestrator task key (for example `example-task`). Must match an existing orchestrator state directory.",
      ),
    mode: z
      .enum([
        "planner_replace_canonical",
        "planner_add_todos",
        "planner_update_todos",
        "executor_update_statuses",
      ])
      .describe(
        "planner_replace_canonical: replace the canonical todo list (planner only). " +
          "planner_add_todos: append new todos with auto-assigned ids (planner only). " +
          "planner_update_todos: patch existing todos based on filters (planner only). " +
          "executor_update_statuses: update statuses for existing todos (executor only).",
      ),
    canonicalTodos: z
      .array(
        z.object({
          id: z.string(),
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
                  "Schema version for the artifact (e.g., investigation_v1, verification_v1). Leave unset for implement todos unless the task contract explicitly defines an implementation artifact schema.",
                )
                .optional(),
              artifact_filename: z
                .string()
                .describe(
                  "Filename under .opencode/orchestrator/<task-name>/artifacts/ (e.g., T12-sample-survey.json).",
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
                path: z
                  .string()
                  .describe(
                    "Workspace-relative path to the artifact file under .opencode/orchestrator/<task-name>/artifacts/.",
                  ),
                summary: z
                  .string()
                  .describe(
                    "One-line English summary of the artifact contents.",
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
                  "Schema version for the artifact (e.g., investigation_v1, verification_v1). Leave unset for implement todos unless the task contract explicitly defines an implementation artifact schema.",
                )
                .optional(),
              artifact_filename: z
                .string()
                .describe(
                  "Filename under .opencode/orchestrator/<task-name>/artifacts/ (e.g., T12-sample-survey.json).",
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
                path: z
                  .string()
                  .describe(
                    "Workspace-relative path to the artifact file under .opencode/orchestrator/<task-name>/artifacts/.",
                  ),
                summary: z
                  .string()
                  .describe(
                    "One-line English summary of the artifact contents.",
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
    updates: z
      .array(
        z.object({
          filter: z
            .object({
              id: z
                .union([z.string(), z.array(z.string())])
                .describe(
                  "Todo id or list of ids. Matches when todo.id is in this set.",
                )
                .optional(),
              related_requirement_ids: z
                .array(z.string())
                .describe(
                  "Match todos whose related_requirement_ids intersect this list.",
                )
                .optional(),
              id_prefix: z
                .string()
                .describe(
                  "Prefix that todo.id must start with to match (e.g. 'T2').",
                )
                .optional(),
              status: z
                .enum(["pending", "in_progress", "completed", "cancelled"])
                .describe("Match todos whose status equals this value.")
                .optional(),
              summary_contains: z
                .string()
                .describe(
                  "Substring to search for within todo.summary. Case-sensitive.",
                )
                .optional(),
              execution_contract_expected_evidence_contains: z
                .string()
                .describe(
                  "Substring to search for within execution_contract.expected_evidence entries.",
                )
                .optional(),
            })
            .describe(
              "Filter describing which existing todos to update. Conditions across fields are combined with AND; multiple values within a field are treated as OR.",
            ),
          patch: z
            .object({
              summary: z
                .string()
                .describe("New summary to assign to matching todos.")
                .optional(),
              related_requirement_ids: z
                .array(z.string())
                .describe(
                  "Full replacement list of related requirement ids for matching todos.",
                )
                .optional(),
              execution_contract: z
                .object({
                  intent: z
                    .enum(["implement", "verify", "investigate"])
                    .optional(),
                  expected_evidence: z.array(z.string()).optional(),
                  command_ids: z.array(z.string()).optional(),
                  audit_ready_when: z.array(z.string()).optional(),
                  artifact_schema: z
                    .string()
                    .describe(
                      "Schema version for the artifact (e.g., investigation_v1, verification_v1). Leave unset for implement todos unless the task contract explicitly defines an implementation artifact schema.",
                    )
                    .optional(),
                  artifact_filename: z
                    .string()
                    .describe(
                      "Filename under .opencode/orchestrator/<task-name>/artifacts/ (e.g., T12-sample-survey.json).",
                    )
                    .optional(),
                })
                .describe(
                  "New execution_contract object to assign to matching todos (replaces any existing contract).",
                )
                .optional(),
              status: z
                .enum(["pending", "in_progress", "completed", "cancelled"])
                .describe(
                  "New status to assign to matching todos. Use primarily for planner-driven cancellations or large-scale plan reshaping; routine progress updates should use executor_update_statuses instead.",
                )
                .optional(),
            })
            .describe(
              "Patch to apply to all todos matching the filter. Only specified fields are overwritten; other fields remain unchanged.",
            ),
        }),
      )
      .describe(
        "Filter + patch updates to apply when mode=planner_update_todos. Each update selects a set of todos and overwrites selected fields.",
      )
      .optional(),
  };
}
