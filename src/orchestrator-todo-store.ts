import * as fs from "node:fs";
import * as path from "node:path";

import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import type {
  CanonicalTodo,
  CanonicalTodoExecutionContract,
  CanonicalTodoFile,
  ResultArtifact,
} from "./orchestrator-todo-types.js";

export function isCanonicalTodoExecutionContractLike(
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

export function isResultArtifactLike(input: unknown): input is ResultArtifact {
  if (!input || typeof input !== "object") return false;
  const obj = input as { kind?: unknown; path?: unknown; summary?: unknown };
  return (
    typeof obj.kind === "string" &&
    typeof obj.path === "string" &&
    typeof obj.summary === "string"
  );
}

export function isCanonicalTodoLike(value: unknown): value is CanonicalTodo {
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

export function loadCanonicalTodos(task: string): {
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

export function saveCanonicalTodos(
  todoPath: string,
  todos: CanonicalTodo[],
): void {
  const fileObj: CanonicalTodoFile = { todos };
  const dir = path.dirname(todoPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(todoPath, JSON.stringify(fileObj, null, 2) + "\n", "utf8");
}

export function buildGeneratedTodoId(
  ordinal: number,
  summary: string,
  relatedRequirementIds: string[],
): string {
  const reqSlug = slugifyTodoPart(relatedRequirementIds[0] ?? "todo");
  const summarySlug = slugifyTodoPart(summary);
  return `T${ordinal}-${reqSlug || "todo"}-${summarySlug || "item"}`;
}

export function slugifyTodoPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
