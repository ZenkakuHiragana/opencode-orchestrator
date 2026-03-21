import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  buildFileArgs,
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

    fs.writeFileSync(acceptancePath, "{}", "utf8");
    fs.writeFileSync(specPath, "# Spec", "utf8");
    fs.writeFileSync(todoPath, "[]", "utf8");

    const opts = { files: ["extra.txt"] } as any;
    const args = buildFileArgs(opts, stateDir);

    expect(args[0]).toBe("--file");
    const files = args.slice(1);
    expect(files).toContain("extra.txt");
    expect(files).toContain(acceptancePath);
    expect(files).toContain(specPath);
    expect(files).toContain(todoPath);

    const unique = new Set(files);
    expect(unique.size).toBe(files.length);
  });

  it("returns empty array when no files are available", () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-session-empty-"),
    );
    const opts = { files: [] } as any;
    const args = buildFileArgs(opts, tmpDir);
    expect(args).toEqual([]);
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
