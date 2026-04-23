import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { LoopOptions } from "./cli-args.js";
import { runOpencode } from "./orchestrator-process.js";
import { withTaskKeyHint } from "./orchestrator-prompts.js";

export async function createInitialSession(
  opts: LoopOptions,
  logDir: string,
  fileArgs: string[],
): Promise<string> {
  const title = `orchestrator-loop ${opts.task} ${new Date().toISOString()}`;
  const firstLog = path.join(logDir, "orch_step_000.txt");

  console.error(
    "[opencode-orchestrator] 初回の todo-writer セッションを開始します...",
  );

  const userPrompt = withTaskKeyHint(opts.prompt, opts.task);

  const res = await runOpencode(
    [
      "run",
      "--command",
      "orch-todo-write",
      "--title",
      title,
      ...fileArgs,
      "--",
      userPrompt,
    ],
    firstLog,
  );

  if (res.code !== 0) {
    throw new Error("初回の todo-writer 実行に失敗しました");
  }

  const sessionId = await findSessionIdByTitle(title);
  if (!sessionId) {
    throw new Error(
      `タイトル '${title}' に対応するセッション ID を特定できませんでした`,
    );
  }

  console.error(`[opencode-orchestrator] 新しいセッション ID: ${sessionId}`);
  return sessionId;
}

export async function restartSession(
  opts: LoopOptions,
  logDir: string,
  fileArgs: string[],
  previousSessionId: string,
): Promise<{ newSessionId: string | null; newTitle: string }> {
  const restartTitle = `orchestrator-loop ${opts.task} ${new Date().toISOString()} [restart]`;
  const firstLog = path.join(logDir, "orch_step_00.txt");

  const restartPromptBase =
    opts.prompt +
    "\n\n----\n\n" +
    "Note: A previous orchestrator session for this goal was interrupted due to a safety or infrastructure trigger (for example, a safety filter or transient environment error). " +
    "The current git working tree already contains all changes made so far. " +
    "Please continue the story from the current repository state. You do not need to reapply past diffs; " +
    "just move the story forward from here.";

  const restartPrompt = withTaskKeyHint(restartPromptBase, opts.task);

  console.error(
    `[opencode-orchestrator] restart 用の新しい todo-writer セッションを開始します: ${restartTitle}`,
  );

  const res = await runOpencode(
    [
      "run",
      "--command",
      "orch-todo-write",
      "--title",
      restartTitle,
      ...fileArgs,
      "--",
      restartPrompt,
    ],
    firstLog,
  );

  if (res.code !== 0) {
    console.error(
      "[opencode-orchestrator] WARN: restart 用の todo-writer 実行に失敗しました",
    );
    return { newSessionId: null, newTitle: restartTitle };
  }

  const newSessionId = await findSessionIdByTitle(restartTitle);
  if (!newSessionId) {
    console.error(
      `[opencode-orchestrator] WARN: タイトル '${restartTitle}' に対応する新しいセッション ID を特定できませんでした`,
    );
    return { newSessionId: null, newTitle: restartTitle };
  }

  return { newSessionId, newTitle: restartTitle };
}

export function appendFileArg(fileArgs: string[], filePath: string): string[] {
  if (fileArgs.includes(filePath)) {
    return fileArgs;
  }
  return [...fileArgs, "--file", filePath];
}

function isSkipCommandPolicyMode(opts: LoopOptions): boolean {
  return !!(opts.dangerouslySkipCommandPolicy || opts.bwrapSkipCommandPolicy);
}

function sanitizeSkipModeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSkipModeJson(entry));
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      return value.replace(/command-policy(?:\.json)?/gi, "command metadata");
    }
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "command_ids" || key === "command_id") {
      continue;
    }
    out[key] = sanitizeSkipModeJson(entry);
  }
  return out;
}

function writeSkipSafeAttachment(
  filePath: string,
  content: string,
): string | null {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencode-orchestrator-skip-"),
  );
  const safeBaseName = path
    .basename(filePath)
    .replace(/command-policy/gi, "command-metadata");
  const targetPath = path.join(tempDir, safeBaseName);
  fs.writeFileSync(targetPath, content, "utf8");
  return targetPath;
}

export function buildSkipSafeAttachment(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const raw = fs.readFileSync(filePath, "utf8");
    if (ext === ".json") {
      const parsed = JSON.parse(raw);
      const sanitized = sanitizeSkipModeJson(parsed);
      return writeSkipSafeAttachment(
        filePath,
        JSON.stringify(sanitized, null, 2),
      );
    }

    return writeSkipSafeAttachment(
      filePath,
      raw.replace(/command-policy(?:\.json)?/gi, "command metadata"),
    );
  } catch {
    return null;
  }
}

export function buildSkipSafeJsonAttachment(filePath: string): string | null {
  return buildSkipSafeAttachment(filePath);
}

export function buildFileArgs(opts: LoopOptions, stateDir: string): string[] {
  const files: string[] = [];
  const skipCommandPolicy = isSkipCommandPolicyMode(opts);

  const pushAttachment = (filePath: string): void => {
    if (skipCommandPolicy) {
      if (path.basename(filePath) === "command-policy.json") {
        return;
      }
      const sanitizedPath = buildSkipSafeAttachment(filePath);
      if (sanitizedPath) {
        files.push(sanitizedPath);
      }
      return;
    }
    files.push(filePath);
  };

  for (const filePath of opts.files) {
    pushAttachment(filePath);
  }

  // In normal policy-respecting mode, attach command-policy.json so that
  // Planner/Executor can see the planned command set. In skip modes
  // (dangerouslySkipCommandPolicy / bwrapSkipCommandPolicy), do **not**
  // attach it so that downstream agents are not tempted to treat a stale
  // or intentionally-ignored policy file as authoritative.
  const commandPolicyPath = path.join(stateDir, "command-policy.json");
  if (!skipCommandPolicy && fs.existsSync(commandPolicyPath)) {
    files.push(commandPolicyPath);
  }

  const acceptanceIndexPath = path.join(stateDir, "acceptance-index.json");
  if (fs.existsSync(acceptanceIndexPath)) {
    pushAttachment(acceptanceIndexPath);
  }

  const specPath = path.join(stateDir, "spec.md");
  if (fs.existsSync(specPath)) {
    pushAttachment(specPath);
  }

  const todoPath = path.join(stateDir, "todo.json");
  if (isValidTodoAttachment(todoPath)) {
    pushAttachment(todoPath);
  }

  if (files.length === 0) {
    return [];
  }

  return Array.from(new Set(files)).flatMap((filePath) => ["--file", filePath]);
}

function isValidTodoAttachment(todoPath: string): boolean {
  if (!fs.existsSync(todoPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(todoPath, "utf8");
    const parsed = JSON.parse(raw) as { todos?: unknown } | unknown[];
    const todos = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { todos?: unknown }).todos)
        ? (parsed as { todos: unknown[] }).todos
        : null;
    return Array.isArray(todos) && todos.every(isCanonicalTodoLike);
  } catch {
    return false;
  }
}

function isCanonicalTodoLike(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const todo = value as {
    id?: unknown;
    summary?: unknown;
    status?: unknown;
    related_requirement_ids?: unknown;
  };
  return (
    typeof todo.id === "string" &&
    typeof todo.summary === "string" &&
    (todo.status === "pending" ||
      todo.status === "in_progress" ||
      todo.status === "completed" ||
      todo.status === "cancelled") &&
    Array.isArray(todo.related_requirement_ids) &&
    todo.related_requirement_ids.every((rid) => typeof rid === "string")
  );
}

export async function findSessionIdByTitle(
  title: string,
): Promise<string | null> {
  const child = await runOpencode(
    ["session", "list", "--format", "json"],
    undefined,
    false,
  );
  if (child.code !== 0 || !child.stdout) {
    return null;
  }

  try {
    const data = JSON.parse(child.stdout) as
      | { id: string; title?: string }[]
      | { sessions: { id: string; title?: string }[] };
    const list = Array.isArray(data)
      ? data
      : Array.isArray(
            (data as { sessions?: { id: string; title?: string }[] }).sessions,
          )
        ? (data as { sessions: { id: string; title?: string }[] }).sessions
        : [];
    const found = list.find((sess) => {
      if (typeof sess.title !== "string") return false;
      const sessTitle = sess.title;
      // タイトルは opencode 側の実装によって一部が省略される可能性があるため、
      // 完全一致ではなく「どちらか一方がもう一方を含む」形でマッチさせる。
      return sessTitle.includes(title) || title.includes(sessTitle);
    });
    return found ? found.id : null;
  } catch {
    return null;
  }
}
