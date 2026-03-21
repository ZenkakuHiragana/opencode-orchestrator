import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";

import {
  getOrchestratorBaseDir,
  getOrchestratorRoot,
  getOrchestratorStateDir,
  getOrchestratorLogsDir,
  rewritePromptPaths,
  rewriteAgentConfigPaths,
} from "../src/orchestrator-paths.js";

describe("orchestrator-paths", () => {
  it("uses XDG_STATE_HOME when set", () => {
    const original = process.env.XDG_STATE_HOME;
    try {
      const tmp = path.join(os.tmpdir(), "xdg-state-test");
      process.env.XDG_STATE_HOME = tmp;
      const base = getOrchestratorBaseDir();
      expect(base).toBe(path.join(tmp, "opencode", "orchestrator"));
      expect(getOrchestratorRoot("task1")).toBe(path.join(base, "task1"));
      expect(getOrchestratorStateDir("task1")).toBe(
        path.join(base, "task1", "state"),
      );
      expect(getOrchestratorLogsDir("task1")).toBe(
        path.join(base, "task1", "logs"),
      );
    } finally {
      if (original === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = original;
      }
    }
  });

  it("falls back to ~/.local/state when XDG_STATE_HOME is not set", () => {
    const original = process.env.XDG_STATE_HOME;
    try {
      delete process.env.XDG_STATE_HOME;
      const base = getOrchestratorBaseDir();
      expect(base).toBe(
        path.join(os.homedir(), ".local", "state", "opencode", "orchestrator"),
      );
    } finally {
      if (original !== undefined) {
        process.env.XDG_STATE_HOME = original;
      }
    }
  });

  it("rewrites placeholder paths in prompt bodies", () => {
    const base = getOrchestratorBaseDir();
    const body = [
      "Use $XDG_STATE_HOME/opencode/orchestrator/foo/state.",
      "Legacy ~/.local/opencode/orchestrator/bar/state path.",
    ].join("\n");

    const rewritten = rewritePromptPaths(body);
    expect(rewritten).toContain(`Use ${path.join(base, "foo", "state")}.`);
    expect(rewritten).toContain(
      `Legacy ${path.join(base, "bar", "state")} path.`,
    );
  });

  it("rewrites nested agent config strings and keys", () => {
    const base = getOrchestratorBaseDir();
    const cfg = {
      external_directory: "$XDG_STATE_HOME/opencode/orchestrator/**",
      write: {
        "$XDG_STATE_HOME/opencode/orchestrator/*/state/acceptance-index.json":
          "allow",
      },
    };

    const out = rewriteAgentConfigPaths(cfg) as any;
    expect(out.external_directory).toBe(path.join(base, "**"));
    const keys = Object.keys(out.write);
    expect(keys[0]).toBe(
      path.join(base, "*", "state", "acceptance-index.json"),
    );
  });
});
