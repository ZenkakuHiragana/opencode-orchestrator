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

export type ProposalWriteInput = {
  kind: string;
  priority: "low" | "medium" | "high" | "critical";
  summary: string;
  details?: string;
  related_requirement_ids: string[];
  related_todo_ids: string[];
  auto_resolvable?: boolean;
};

export type CanonicalTodoFile = {
  todos: CanonicalTodo[];
};
