import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildFileArgs } from "../src/cli.js";

function withTempStateDir(task: string, fn: (stateDir: string) => void) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));
  const stateDir = path.join(base, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  try {
    fn(stateDir);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

describe("buildFileArgs", () => {
  it("returns empty array when no files exist", () => {
    withTempStateDir("task", (stateDir) => {
      const args = buildFileArgs(
        {
          task: "task",
          prompt: "p",
          sessionId: undefined,
          continueLast: false,
          commitOnDone: false,
          maxLoop: 1,
          maxRestarts: 0,
          files: [],
        },
        stateDir,
      );
      expect(args).toEqual([]);
    });
  });

  it("includes user files and orchestrator artifacts when present", () => {
    withTempStateDir("taskX", (stateDir) => {
      const homedir = os.homedir();
      const acc = path.join(stateDir, "acceptance-index.json");
      const todo = path.join(stateDir, "todo.json");
      const spec = path.join(stateDir, "spec.md");
      fs.writeFileSync(acc, "{}", "utf8");
      fs.writeFileSync(
        todo,
        JSON.stringify({
          todos: [
            {
              id: "T1",
              summary: "valid todo",
              status: "pending",
              related_requirement_ids: ["R1"],
            },
          ],
        }),
        "utf8",
      );
      fs.writeFileSync(spec, "# spec", "utf8");

      const args = buildFileArgs(
        {
          task: "taskX",
          prompt: "p",
          sessionId: undefined,
          continueLast: false,
          commitOnDone: false,
          maxLoop: 1,
          maxRestarts: 0,
          files: ["user.txt"],
        },
        stateDir,
      );

      expect(args).toEqual([
        "--file",
        "user.txt",
        "--file",
        acc,
        "--file",
        spec,
        "--file",
        todo,
      ]);
      const files = args.filter((arg) => arg !== "--file");
      expect(files).toContain("user.txt");
      expect(files).toContain(acc);
      expect(files).toContain(todo);
      expect(files).toContain(spec);
    });
  });

  it("skips invalid todo.json artifacts even when the file exists", () => {
    withTempStateDir("taskY", (stateDir) => {
      const todo = path.join(stateDir, "todo.json");
      fs.writeFileSync(todo, JSON.stringify({ todos: [{}] }), "utf8");

      const args = buildFileArgs(
        {
          task: "taskY",
          prompt: "p",
          sessionId: undefined,
          continueLast: false,
          commitOnDone: false,
          maxLoop: 1,
          maxRestarts: 0,
          files: [],
        },
        stateDir,
      );

      expect(args).not.toContain(todo);
    });
  });
});
