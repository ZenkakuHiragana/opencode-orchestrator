import * as fs from "node:fs";
import * as path from "node:path";

import {
  getOrchestratorProposalsPath,
  getOrchestratorStateDir,
} from "./orchestrator-paths.js";
import {
  createProposalEntry,
  loadProposals,
  saveProposals,
} from "./orchestrator-proposals.js";
import {
  buildGeneratedTodoId,
  loadCanonicalTodos,
  saveCanonicalTodos,
} from "./orchestrator-todo-store.js";
import type { CanonicalTodo } from "./orchestrator-todo-types.js";

export async function executeOrchTodoWrite(
  args: any,
  context: unknown,
): Promise<string> {
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

  if (args.mode === "planner_add_proposals") {
    if (agentName !== "orch-todo-writer") {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: mode=planner_add_proposals may only be used by orch-todo-writer.",
      });
    }
    if (!args.addProposals || args.addProposals.length === 0) {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: mode=planner_add_proposals requires non-empty addProposals array.",
      });
    }

    const proposalsPath = getOrchestratorProposalsPath(args.task);
    const proposalsFile = loadProposals(proposalsPath);
    const statusPath = path.join(
      getOrchestratorStateDir(args.task),
      "status.json",
    );
    let currentCycle = 0;
    try {
      if (fs.existsSync(statusPath)) {
        const statusRaw = fs.readFileSync(statusPath, "utf8");
        const statusJson = JSON.parse(statusRaw) as { current_cycle?: unknown };
        if (typeof statusJson.current_cycle === "number") {
          currentCycle = statusJson.current_cycle;
        }
      }
    } catch {
      currentCycle = 0;
    }

    const addedIds: string[] = [];
    for (const item of args.addProposals) {
      const entry = createProposalEntry({
        source: "todo_writer",
        cycle: currentCycle,
        kind: item.kind,
        priority: item.priority,
        summary: item.summary,
        details: item.details,
        related_requirement_ids: item.related_requirement_ids,
        related_todo_ids: item.related_todo_ids,
        auto_resolvable: item.auto_resolvable ?? true,
      });
      proposalsFile.proposals.push(entry);
      addedIds.push(entry.id);
    }

    saveProposals(proposalsPath, proposalsFile);
    return JSON.stringify({ ok: true, addedIds });
  }

  if (args.mode === "planner_update_todos") {
    if (agentName !== "orch-todo-writer") {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: mode=planner_update_todos may only be used by orch-todo-writer.",
      });
    }
    if (!args.updates || args.updates.length === 0) {
      return JSON.stringify({
        ok: false,
        error:
          "SPEC_ERROR: mode=planner_update_todos requires non-empty updates array.",
      });
    }

    const byId = new Map<string, CanonicalTodo>();
    for (const t of existing) {
      byId.set(t.id, { ...t });
    }

    const updatedIds = new Set<string>();

    for (let index = 0; index < args.updates.length; index += 1) {
      const update = args.updates[index];
      const filter = update.filter;
      const patch = update.patch;

      const hasFilterField = Boolean(
        (Array.isArray(filter.id)
          ? filter.id.length > 0
          : typeof filter.id === "string") ||
        (filter.related_requirement_ids &&
          filter.related_requirement_ids.length > 0) ||
        (filter.id_prefix && filter.id_prefix.length > 0) ||
        filter.status ||
        (filter.summary_contains && filter.summary_contains.length > 0) ||
        (filter.execution_contract_expected_evidence_contains &&
          filter.execution_contract_expected_evidence_contains.length > 0),
      );
      if (!hasFilterField) {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: planner_update_todos update[" +
            index +
            "] has an empty filter; at least one criterion is required.",
        });
      }

      const hasPatchField =
        patch.summary !== undefined ||
        patch.related_requirement_ids !== undefined ||
        patch.execution_contract !== undefined ||
        patch.status !== undefined;

      if (!hasPatchField) {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: planner_update_todos update[" +
            index +
            "] has an empty patch; at least one field must be specified.",
        });
      }

      const matches: CanonicalTodo[] = [];

      const filterIdSet =
        Array.isArray(filter.id) && filter.id.length > 0
          ? new Set(filter.id)
          : undefined;
      const filterReqSet =
        filter.related_requirement_ids &&
        filter.related_requirement_ids.length > 0
          ? new Set(filter.related_requirement_ids)
          : undefined;

      for (const todo of byId.values()) {
        if (typeof filter.id === "string") {
          if (todo.id !== filter.id) continue;
        } else if (filterIdSet) {
          if (!filterIdSet.has(todo.id)) continue;
        }

        if (filterReqSet) {
          if (
            !todo.related_requirement_ids.some((rid) => filterReqSet.has(rid))
          ) {
            continue;
          }
        }

        if (filter.id_prefix && !todo.id.startsWith(filter.id_prefix)) {
          continue;
        }

        if (filter.status && todo.status !== filter.status) {
          continue;
        }

        if (
          filter.summary_contains &&
          !todo.summary.includes(filter.summary_contains)
        ) {
          continue;
        }

        if (filter.execution_contract_expected_evidence_contains) {
          const contract = todo.execution_contract;
          const needle = filter.execution_contract_expected_evidence_contains;
          const hasMatch = Array.isArray(contract?.expected_evidence)
            ? contract.expected_evidence.some((s) => s.includes(needle))
            : false;
          if (!hasMatch) continue;
        }

        matches.push(todo);
      }

      if (matches.length === 0) {
        return JSON.stringify({
          ok: false,
          error:
            "SPEC_ERROR: planner_update_todos filter at index " +
            index +
            " did not match any todos.",
        });
      }

      for (const original of matches) {
        const current = byId.get(original.id) ?? original;
        const next: CanonicalTodo = { ...current };

        if (patch.summary !== undefined) {
          next.summary = patch.summary;
        }
        if (patch.related_requirement_ids !== undefined) {
          next.related_requirement_ids = patch.related_requirement_ids;
        }
        if (patch.execution_contract !== undefined) {
          next.execution_contract = patch.execution_contract;
        }
        if (patch.status !== undefined) {
          next.status = patch.status;
        }

        byId.set(next.id, next);
        updatedIds.add(next.id);
      }
    }

    const updated = Array.from(byId.values());
    saveCanonicalTodos(todoPath, updated);
    return JSON.stringify({ ok: true, updatedIds: Array.from(updatedIds) });
  }

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
}
