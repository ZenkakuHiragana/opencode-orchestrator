import * as fs from "node:fs";
import * as path from "node:path";
import {
  getOrchestratorBaseDir,
  getOrchestratorStateDir,
} from "./orchestrator-paths.js";

export interface TaskInfo {
  task: string;
  stateDir: string;
}

export interface TaskSuggestion {
  task: string;
  score: number;
}

export function listKnownTasks(): TaskInfo[] {
  const baseDir = getOrchestratorBaseDir();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const tasks: TaskInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const task = entry.name;
    const stateDir = getOrchestratorStateDir(task);
    try {
      if (!fs.existsSync(stateDir) || !fs.statSync(stateDir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    tasks.push({ task, stateDir });
  }

  tasks.sort((a, b) => a.task.localeCompare(b.task));
  return tasks;
}

export function computeEditDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i += 1) {
    dp[i] = [];
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j += 1) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

export function suggestTasks(
  input: string,
  tasks: string[],
  limit = 5,
): TaskSuggestion[] {
  const trimmed = input.trim();
  if (!trimmed || tasks.length === 0) {
    return [];
  }

  const suggestions: TaskSuggestion[] = [];
  for (const task of tasks) {
    const score = computeEditDistance(trimmed, task);
    suggestions.push({ task, score });
  }

  suggestions.sort((a, b) => a.score - b.score || a.task.localeCompare(b.task));

  const best = suggestions[0];
  if (!best) return [];

  const maxScore = Math.max(
    3,
    Math.floor(Math.max(trimmed.length, best.task.length) / 2),
  );
  const filtered = suggestions.filter((s) => s.score <= maxScore);

  return filtered.slice(0, limit);
}

export function sortTasksByRecency(infos: TaskInfo[], limit = 5): TaskInfo[] {
  if (infos.length === 0 || limit <= 0) return [];

  type TaskWithTime = TaskInfo & { mtimeMs: number };

  const withTimes: TaskWithTime[] = infos.map((info) => {
    const candidates: string[] = [
      info.stateDir,
      path.join(info.stateDir, "status.json"),
      path.join(info.stateDir, "command-policy.json"),
      path.join(info.stateDir, "proposals.json"),
      path.join(info.stateDir, "todo.json"),
    ];

    let best = 0;
    for (const p of candidates) {
      try {
        const stat = fs.statSync(p);
        if (stat.mtimeMs > best) {
          best = stat.mtimeMs;
        }
      } catch {
        // ignore missing files
      }
    }

    return { ...info, mtimeMs: best };
  });

  withTimes.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return a.task.localeCompare(b.task);
  });

  return withTimes
    .slice(0, limit)
    .map(({ task, stateDir }) => ({ task, stateDir }));
}

export function suggestRecentTasks(
  input: string,
  infos: TaskInfo[],
  limit = 5,
): string[] {
  const trimmed = input.trim();
  if (!trimmed || infos.length === 0 || limit <= 0) {
    return [];
  }

  const recent = sortTasksByRecency(infos, infos.length);

  const maxScore = Math.max(3, Math.floor(trimmed.length / 2));
  const candidates: string[] = [];

  for (const info of recent) {
    const score = computeEditDistance(trimmed, info.task);
    if (score <= maxScore) {
      candidates.push(info.task);
      if (candidates.length >= limit) break;
    }
  }

  return candidates;
}
