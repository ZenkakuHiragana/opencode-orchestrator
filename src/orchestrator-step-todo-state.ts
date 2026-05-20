import * as fs from "node:fs";
import * as path from "node:path";

import { isCanonicalTodoLike } from "./orchestrator-todo-store.js";
import type {
  CoverageCheckResult,
  MinimalTodo,
  TodoSummary,
} from "./orchestrator-step-types.js";
import type { OrchestratorStatus } from "./orchestrator-status.js";
import type { CanonicalTodo } from "./orchestrator-todo-types.js";

const ACTIVE_TODO_STATUSES = new Set<string>(["pending", "in_progress"]);

const NON_DISPATCH_SUMMARY_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "planner-only", regex: /\bplanner-(?:only|held)\b/i },
  { label: "planner-owned", regex: /\bplanner-owned\b/i },
  { label: "wait-state", regex: /\bwait-state\b/i },
  { label: "non-dispatch", regex: /\bnon-dispatch\b/i },
  { label: "not-executor-runnable", regex: /not executor-runnable/i },
  { label: "do-not-dispatch", regex: /do not (?:dispatch|send) executor/i },
  { label: "coverage-placeholder", regex: /\bcoverage placeholder\b/i },
  { label: "coverage-only", regex: /\bcoverage only\b/i },
  {
    label: "passive-coverage-gate",
    regex: /preserve .* coverage until .*\b(?:signal|packet|proof|evidence)\b/i,
  },
  {
    label: "future-signal-gate",
    regex:
      /awaiting a newly attached|until a newly attached|until a later attached/i,
  },
];

const NON_DISPATCH_CONTRACT_PATTERNS: Array<{ label: string; regex: RegExp }> =
  [
    {
      label: "immediate-step-blocker",
      regex: /executor must emit\s+`?step_blocker`?\s+immediately/i,
    },
    {
      label: "leave-unexecuted",
      regex: /leave this .* unexecuted/i,
    },
    {
      label: "block-immediately",
      regex: /executor should block immediately/i,
    },
    {
      label: "selected-only-after-later-signal",
      regex: /selected only after .* newly attached/i,
    },
    {
      label: "no-later-signal-yet",
      regex: /when no later signal is attached yet/i,
    },
    {
      label: "rerun-planning-not-executor",
      regex: /rerun planning(?:,? not executor)?/i,
    },
    {
      label: "same-shape-rerun-block",
      regex: /do not generate another same-shape rerun/i,
    },
  ];

type RuntimeTodoLike = Pick<
  CanonicalTodo,
  "id" | "summary" | "status" | "execution_contract"
>;

function summarizeTodoEscapeReasons(todo: RuntimeTodoLike): string[] {
  if (!ACTIVE_TODO_STATUSES.has(todo.status)) {
    return [];
  }

  const reasons = new Set<string>();
  const summary = todo.summary ?? "";

  for (const { label, regex } of NON_DISPATCH_SUMMARY_PATTERNS) {
    if (regex.test(summary)) {
      reasons.add(`summary:${label}`);
    }
  }

  const contractTexts = [
    ...(todo.execution_contract?.expected_evidence ?? []),
    ...(todo.execution_contract?.audit_ready_when ?? []),
  ];

  for (const text of contractTexts) {
    for (const { label, regex } of NON_DISPATCH_CONTRACT_PATTERNS) {
      if (regex.test(text)) {
        reasons.add(`contract:${label}`);
      }
    }
  }

  return Array.from(reasons);
}

export function validateNoExecutorEscapeActiveTodos(
  todos: RuntimeTodoLike[],
): CoverageCheckResult {
  const flagged = todos
    .map((todo) => {
      const reasons = summarizeTodoEscapeReasons(todo);
      return reasons.length > 0
        ? `${todo.id} [${reasons.join(", ")}] ${todo.summary}`
        : null;
    })
    .filter((value): value is string => value !== null);

  if (flagged.length === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      "active todos must be executor-runnable and may not encode planner-only / wait-state / non-dispatch escape hatches: " +
      flagged.join("; "),
  };
}

export function validateTodoActionability(
  todoPath: string,
): CoverageCheckResult {
  if (!fs.existsSync(todoPath)) {
    return { ok: false, reason: "todo.json missing" };
  }

  try {
    const todoRaw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(todoRaw) as { todos?: unknown } | unknown[];
    const todosUnknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;

    if (!todosUnknown || !todosUnknown.every(isCanonicalTodoLike)) {
      return { ok: false, reason: "todo.json has invalid shape" };
    }

    return validateNoExecutorEscapeActiveTodos(
      todosUnknown as RuntimeTodoLike[],
    );
  } catch {
    return { ok: false, reason: "todo.json parse failed" };
  }
}

export function readTodoSummary(todoPath: string): TodoSummary {
  if (!fs.existsSync(todoPath)) {
    return { ok: false, reason: "todo.json missing" };
  }

  try {
    const todoRaw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(todoRaw) as { todos?: unknown } | unknown[];
    const todos = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;
    if (!todos || !todos.every(isCanonicalTodoLike)) {
      return { ok: false, reason: "todo.json has invalid shape" };
    }
    return {
      ok: true,
      total: todos.length,
      pending: todos.filter(
        (t) => t && (t as { status?: string }).status === "pending",
      ).length,
      inProgress: todos.filter(
        (t) => t && (t as { status?: string }).status === "in_progress",
      ).length,
      completed: todos.filter(
        (t) => t && (t as { status?: string }).status === "completed",
      ).length,
      cancelled: todos.filter(
        (t) => t && (t as { status?: string }).status === "cancelled",
      ).length,
    };
  } catch {
    return { ok: false, reason: "todo.json parse failed" };
  }
}

export function validateTodoCoverage(
  acceptanceIndexPath: string,
  status: OrchestratorStatus,
  todoPath: string,
): CoverageCheckResult {
  if (!fs.existsSync(acceptanceIndexPath)) {
    return { ok: true };
  }

  if (!fs.existsSync(todoPath)) {
    return { ok: false, reason: "todo.json missing" };
  }

  let requirementIds: string[] = [];
  try {
    const raw = fs.readFileSync(acceptanceIndexPath, "utf8");
    const parsed = JSON.parse(raw) as {
      requirements?: { id?: unknown }[];
    };
    if (Array.isArray(parsed.requirements)) {
      requirementIds = parsed.requirements
        .map((req) =>
          req && typeof req.id === "string" ? (req.id as string) : null,
        )
        .filter((id): id is string => id !== null);
    }
  } catch {
    return { ok: true };
  }

  if (requirementIds.length === 0) {
    return { ok: true };
  }

  const report = status.last_auditor_report;
  let unsatisfiedIds: string[];
  if (!report || !Array.isArray(report.requirements)) {
    unsatisfiedIds = requirementIds;
  } else {
    const passedMap = new Map<string, boolean>();
    for (const r of report.requirements) {
      if (r && typeof r.id === "string") {
        passedMap.set(r.id, !!r.passed);
      }
    }
    unsatisfiedIds = requirementIds.filter((id) => passedMap.get(id) !== true);
  }

  if (unsatisfiedIds.length === 0) {
    return { ok: true };
  }

  try {
    const todoRaw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(todoRaw) as { todos?: unknown } | unknown[];
    const todosUnknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;

    if (!todosUnknown || !todosUnknown.every(isCanonicalTodoLike)) {
      return { ok: false, reason: "todo.json has invalid shape" };
    }

    type TodoLike = {
      status: string;
      related_requirement_ids: string[];
    };

    const todos = todosUnknown as TodoLike[];
    const missingActive: string[] = [];

    for (const reqId of unsatisfiedIds) {
      const hasActive = todos.some(
        (t) =>
          ACTIVE_TODO_STATUSES.has(t.status) &&
          Array.isArray(t.related_requirement_ids) &&
          t.related_requirement_ids.includes(reqId),
      );
      if (!hasActive) {
        missingActive.push(reqId);
      }
    }

    if (missingActive.length > 0) {
      return {
        ok: false,
        reason:
          "coverage invariant violated for requirements without active todos: " +
          missingActive.join(", "),
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: "todo.json parse failed" };
  }
}

export function normalizeTodoFile(todoPath: string): string | null {
  if (!fs.existsSync(todoPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(raw) as { todos?: unknown } | unknown[];
    const todos = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;
    if (!todos) {
      return null;
    }
    return JSON.stringify(todos);
  } catch {
    return null;
  }
}

export function loadMinimalTodos(todoPath: string): MinimalTodo[] | null {
  if (!fs.existsSync(todoPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(raw) as { todos?: unknown } | unknown[];
    const todosUnknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;
    if (!todosUnknown || !todosUnknown.every(isCanonicalTodoLike)) {
      return null;
    }

    type TodoLike = {
      id: string;
      status: string;
      related_requirement_ids: string[];
      execution_contract?: {
        intent?: string;
        expected_evidence?: string[];
        audit_ready_when?: string[];
      };
    };

    const todos = todosUnknown as TodoLike[];
    return todos.map<MinimalTodo>((t) => ({
      id: t.id,
      status: t.status,
      related_requirement_ids: Array.isArray(t.related_requirement_ids)
        ? t.related_requirement_ids
        : [],
      intent: t.execution_contract?.intent,
      expected_evidence: t.execution_contract?.expected_evidence,
      audit_ready_when: t.execution_contract?.audit_ready_when,
    }));
  } catch {
    return null;
  }
}

export function hasMeaningfulTodoChangeForRequirement(
  requirementId: string,
  prevTodos: MinimalTodo[] | null,
  nextTodos: MinimalTodo[] | null,
): boolean {
  const prev = prevTodos ?? [];
  const next = nextTodos ?? [];

  const prevForReq = prev.filter((t) =>
    Array.isArray(t.related_requirement_ids)
      ? t.related_requirement_ids.includes(requirementId)
      : false,
  );
  const nextForReq = next.filter((t) =>
    Array.isArray(t.related_requirement_ids)
      ? t.related_requirement_ids.includes(requirementId)
      : false,
  );

  if (nextForReq.length === 0) {
    return false;
  }

  const prevIds = new Set(prevForReq.map((t) => t.id));
  const hasNewTodo = nextForReq.some((t) => !prevIds.has(t.id));
  if (hasNewTodo) {
    return true;
  }

  for (const nextTodo of nextForReq) {
    const prevTodo = prevForReq.find((t) => t.id === nextTodo.id);
    if (!prevTodo) {
      continue;
    }

    if (prevTodo.intent !== nextTodo.intent) {
      return true;
    }

    const prevEE = prevTodo.expected_evidence ?? [];
    const nextEE = nextTodo.expected_evidence ?? [];
    if (nextEE.length > prevEE.length) {
      return true;
    }

    const prevARW = prevTodo.audit_ready_when ?? [];
    const nextARW = nextTodo.audit_ready_when ?? [];
    if (nextARW.length > prevARW.length) {
      return true;
    }
  }

  return false;
}

export function hasPersistedVerificationEvidence(stateDir: string): boolean {
  const todoPath = path.join(stateDir, "todo.json");
  if (!fs.existsSync(todoPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(raw) as { todos?: unknown } | unknown[];
    const todosUnknown = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;

    if (!todosUnknown) {
      return false;
    }

    for (const value of todosUnknown) {
      if (!value || typeof value !== "object") continue;
      const todo = value as {
        status?: unknown;
        result_artifacts?: unknown;
      };

      if (todo.status !== "completed") {
        continue;
      }

      if (!Array.isArray(todo.result_artifacts)) {
        continue;
      }

      const hasValidArtifact = todo.result_artifacts.some((artifact) => {
        if (!artifact || typeof artifact !== "object") return false;
        const obj = artifact as {
          kind?: unknown;
          path?: unknown;
          summary?: unknown;
        };
        return (
          typeof obj.kind === "string" &&
          typeof obj.path === "string" &&
          typeof obj.summary === "string"
        );
      });

      if (hasValidArtifact) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}
