import os from "node:os";
import path from "node:path";

// Compute the base directory for orchestrator state using XDG_STATE_HOME when
// available, otherwise falling back to ~/.local/state/opencode/orchestrator.
export function getOrchestratorBaseDir(): string {
  const xdgState = process.env.XDG_STATE_HOME;
  const base =
    xdgState && path.isAbsolute(xdgState)
      ? path.join(xdgState, "opencode", "orchestrator")
      : path.join(os.homedir(), ".local", "state", "opencode", "orchestrator");
  return base;
}

export function getOrchestratorRoot(task: string): string {
  return path.join(getOrchestratorBaseDir(), task);
}

export function getOrchestratorStateDir(task: string): string {
  return path.join(getOrchestratorRoot(task), "state");
}

export function getOrchestratorLogsDir(task: string): string {
  return path.join(getOrchestratorRoot(task), "logs");
}

// Internal helper: replace XDG/state placeholders in a single string.
function replaceStatePlaceholders(text: string): string {
  const baseDir = getOrchestratorBaseDir();
  const placeholderPattern =
    /(\$XDG_STATE_HOME\/opencode\/orchestrator|~\/\.local\/opencode\/orchestrator|~\/\.local\/state\/opencode\/orchestrator)((?:\/[A-Za-z0-9._*-]+)*)/g;

  return text.replace(placeholderPattern, (_match, _prefix, suffix: string) => {
    const segments = suffix.split("/").filter(Boolean);
    return segments.length > 0 ? path.join(baseDir, ...segments) : baseDir;
  });
}

// Rewrite markdown prompt bodies so that any placeholder `$XDG_STATE_HOME` or
// legacy `~/.local/opencode/orchestrator` paths are replaced with the actual
// orchestrator base directory for this environment.
export function rewritePromptPaths(body: string): string {
  return replaceStatePlaceholders(body);
}

// Rewrite all string values and object keys inside an agent config so that
// any `$XDG_STATE_HOME`/legacy state paths are replaced with the actual
// orchestrator base directory. This is used both for prompts and for
// permission patterns like external_directory/write.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rewriteAgentConfigPaths<T = any>(value: T): T {
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      return replaceStatePlaceholders(v);
    }
    if (Array.isArray(v)) {
      return v.map((item) => visit(item));
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const newKey = typeof k === "string" ? replaceStatePlaceholders(k) : k;
        out[newKey] = visit(val);
      }
      return out;
    }
    return v;
  };

  return visit(value) as T;
}
