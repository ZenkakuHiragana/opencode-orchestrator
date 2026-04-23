import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  appendFileArg,
  buildFileArgs,
  buildSkipSafeJsonAttachment,
  findSessionIdByTitle,
} from "../src/orchestrator-session.js";
import { runOpencode } from "../src/orchestrator-process.js";

vi.mock("../src/orchestrator-process.js", () => ({
  runOpencode: vi.fn(),
}));

const mockRunOpencode = runOpencode as unknown as ReturnType<typeof vi.fn>;

describe("buildFileArgs", () => {
  it("includes user-specified files and known state files", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-session-"));
    const stateDir = tmpDir;

    const acceptancePath = path.join(stateDir, "acceptance-index.json");
    const specPath = path.join(stateDir, "spec.md");
    const todoPath = path.join(stateDir, "todo.json");

    fs.writeFileSync(
      acceptancePath,
      JSON.stringify({ note: "command-policy should stay hidden" }),
      "utf8",
    );
    fs.writeFileSync(specPath, "# Spec\ncommand-policy reference", "utf8");
    fs.writeFileSync(
      todoPath,
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

    const opts = { files: ["extra.txt"] } as any;
    const args = buildFileArgs(opts, stateDir);

    expect(args).toEqual([
      "--file",
      "extra.txt",
      "--file",
      acceptancePath,
      "--file",
      specPath,
      "--file",
      todoPath,
    ]);
    const files = args.filter((arg) => arg !== "--file");
    expect(files).toContain("extra.txt");
    expect(files).toContain(acceptancePath);
    expect(files).toContain(specPath);
    expect(files).toContain(todoPath);

    const unique = new Set(files);
    expect(unique.size).toBe(files.length);
  });

  it("does not attach invalid todo.json artifacts", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-session-invalid-"),
    );
    const todoPath = path.join(tmpDir, "todo.json");
    fs.writeFileSync(todoPath, JSON.stringify({ todos: [{}] }), "utf8");

    const args = buildFileArgs({ files: [] } as any, tmpDir);

    expect(args).not.toContain(todoPath);
  });

  it("returns empty array when no files are available", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-session-empty-"),
    );
    const opts = { files: [] } as any;
    const args = buildFileArgs(opts, tmpDir);
    expect(args).toEqual([]);
  });

  it("filters command-policy attachments and sanitizes todo.json in skip-command-policy mode", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-session-skip-"));
    const acceptancePath = path.join(tmpDir, "acceptance-index.json");
    const specPath = path.join(tmpDir, "spec.md");
    const todoPath = path.join(tmpDir, "todo.json");
    const policyPath = path.join(tmpDir, "command-policy.json");
    const extraPath = path.join(tmpDir, "notes-command-policy.md");

    fs.writeFileSync(
      acceptancePath,
      JSON.stringify({ note: "command-policy should stay hidden" }),
      "utf8",
    );
    fs.writeFileSync(specPath, "# Spec\ncommand-policy reference", "utf8");
    fs.writeFileSync(policyPath, JSON.stringify({ commands: [] }), "utf8");
    fs.writeFileSync(extraPath, "command-policy scratch note", "utf8");
    fs.writeFileSync(
      todoPath,
      JSON.stringify({
        todos: [
          {
            id: "T1",
            summary: "valid todo",
            status: "pending",
            related_requirement_ids: ["R1"],
            execution_contract: {
              intent: "verify",
              command_ids: ["cmd-test"],
            },
          },
        ],
      }),
      "utf8",
    );

    const args = buildFileArgs(
      {
        files: [extraPath, policyPath],
        bwrapSkipCommandPolicy: true,
      } as any,
      tmpDir,
    );

    const files = args.filter((arg) => arg !== "--file");
    expect(files).not.toContain(policyPath);
    expect(files).not.toContain(todoPath);
    expect(files).not.toContain(acceptancePath);
    expect(files).not.toContain(specPath);
    expect(files).not.toContain(extraPath);

    const attachedTodoPath = files.find((filePath) =>
      filePath.endsWith(`${path.sep}todo.json`),
    );
    const attachedAcceptancePath = files.find((filePath) =>
      filePath.endsWith(`${path.sep}acceptance-index.json`),
    );
    const attachedSpecPath = files.find((filePath) =>
      filePath.endsWith(`${path.sep}spec.md`),
    );
    const attachedExtraPath = files.find((filePath) =>
      filePath.endsWith(`${path.sep}notes-command-metadata.md`),
    );
    expect(attachedTodoPath).toBeTruthy();
    expect(attachedAcceptancePath).toBeTruthy();
    expect(attachedSpecPath).toBeTruthy();
    expect(attachedExtraPath).toBeTruthy();
    const attachedTodo = JSON.parse(
      fs.readFileSync(attachedTodoPath as string, "utf8"),
    );
    expect(
      attachedTodo.todos[0].execution_contract.command_ids,
    ).toBeUndefined();
    expect(
      fs.readFileSync(attachedAcceptancePath as string, "utf8"),
    ).not.toContain("command-policy");
    expect(fs.readFileSync(attachedSpecPath as string, "utf8")).not.toContain(
      "command-policy",
    );
    expect(fs.readFileSync(attachedExtraPath as string, "utf8")).not.toContain(
      "command-policy",
    );
  });

  it("appends additional file attachments with their own --file flag", () => {
    expect(appendFileArg(["--file", "a.txt"], "b.txt")).toEqual([
      "--file",
      "a.txt",
      "--file",
      "b.txt",
    ]);
    expect(appendFileArg(["--file", "a.txt"], "a.txt")).toEqual([
      "--file",
      "a.txt",
    ]);
  });
});

describe("findSessionIdByTitle", () => {
  beforeEach(() => {
    mockRunOpencode.mockReset();
  });

  it("delegates to runOpencode session list and matches by title substring", async () => {
    const payload = [
      { id: "ses-1", title: "orchestrator-loop other-task" },
      { id: "ses-2", title: "orchestrator-audit my-task step=3" },
    ];

    mockRunOpencode.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify(payload),
    } as any);

    const id = await findSessionIdByTitle("my-task step=3");
    expect(id).toBe("ses-2");

    expect(mockRunOpencode).toHaveBeenCalledTimes(1);
    expect(mockRunOpencode.mock.calls[0][0]).toEqual([
      "session",
      "list",
      "--format",
      "json",
    ]);
  });
});

describe("buildSkipSafeJsonAttachment", () => {
  it("redacts command-policy strings and command id fields", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-session-redact-"),
    );
    const statusPath = path.join(tmpDir, "status.json");
    fs.writeFileSync(
      statusPath,
      JSON.stringify({
        failure_budget: {
          last_failure_summary: "command-policy.json is missing",
        },
        last_executor_step: {
          step_cmd: [
            {
              command: "npm test",
              command_id: "cmd-test",
              outcome: "blocked by command-policy",
            },
          ],
        },
      }),
      "utf8",
    );

    const sanitizedPath = buildSkipSafeJsonAttachment(statusPath);
    expect(typeof sanitizedPath).toBe("string");

    const sanitized = JSON.parse(
      fs.readFileSync(sanitizedPath as string, "utf8"),
    );
    expect(JSON.stringify(sanitized)).not.toContain("command-policy");
    expect(sanitized.last_executor_step.step_cmd[0].command_id).toBeUndefined();
    expect(sanitized.failure_budget.last_failure_summary).toContain(
      "command metadata",
    );
  });
});
