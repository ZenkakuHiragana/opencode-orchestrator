import * as fs from "node:fs";
import * as path from "node:path";

import type { LoopOptions } from "./cli-args.js";
import { runOpencode } from "./orchestrator-process.js";

export async function createInitialSession(
  opts: LoopOptions,
  logDir: string,
  fileArgs: string[],
): Promise<string> {
  const title = `orchestrator-loop ${opts.task} ${new Date().toISOString()}`;
  const firstLog = path.join(logDir, "orch_step_000.txt");

  console.error("[opencode-orchestrator] starting todo-writer session...");

  const res = await runOpencode(
    [
      "run",
      "--command",
      "orch-todo-write",
      "--title",
      title,
      ...fileArgs,
      "--",
      opts.prompt,
    ],
    firstLog,
  );

  if (res.code !== 0) {
    throw new Error("initial todo-writer run failed");
  }

  const sessionId = await findSessionIdByTitle(title);
  if (!sessionId) {
    throw new Error(`failed to locate session for title: ${title}`);
  }

  console.error(`[opencode-orchestrator] new session id: ${sessionId}`);
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

  const restartPrompt =
    opts.prompt +
    "\n\n----\n\n" +
    "Note: A previous orchestrator session for this goal was interrupted due to a safety trigger. " +
    "The current git working tree already contains all changes made so far. " +
    "Please continue the story from the current repository state. You do not need to reapply past diffs; " +
    "just move the story forward from here.";

  console.error(
    `[opencode-orchestrator] starting new todo-writer session for restart: ${restartTitle}`,
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
      "[opencode-orchestrator] WARN: restart todo-writer run failed",
    );
    return { newSessionId: null, newTitle: restartTitle };
  }

  const newSessionId = await findSessionIdByTitle(restartTitle);
  if (!newSessionId) {
    console.error(
      `[opencode-orchestrator] WARN: failed to locate new sessionID for title: ${restartTitle}`,
    );
    return { newSessionId: null, newTitle: restartTitle };
  }

  return { newSessionId, newTitle: restartTitle };
}

export function buildFileArgs(opts: LoopOptions, stateDir: string): string[] {
  const files: string[] = [];

  files.push(...opts.files);

  const acceptanceIndexPath = path.join(stateDir, "acceptance-index.json");
  if (fs.existsSync(acceptanceIndexPath)) {
    files.push(acceptanceIndexPath);
  }

  const specPath = path.join(stateDir, "spec.md");
  if (fs.existsSync(specPath)) {
    files.push(specPath);
  }

  const todoPath = path.join(stateDir, "todo.json");
  if (fs.existsSync(todoPath)) {
    files.push(todoPath);
  }

  if (files.length === 0) {
    return [];
  }

  return ["--file", ...Array.from(new Set(files))];
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
    const found = list.find(
      (sess) => typeof sess.title === "string" && sess.title.includes(title),
    );
    return found ? found.id : null;
  } catch {
    return null;
  }
}
