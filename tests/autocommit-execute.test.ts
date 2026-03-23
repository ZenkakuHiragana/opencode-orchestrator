import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(cmd: string, args: string[], cwd: string) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    throw new Error(
      `command failed: ${cmd} ${args.join(" ")}\nstdout=${res.stdout}\nstderr=${res.stderr}`,
    );
  }
  return res;
}

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("autocommit tool execute", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let repoDir = "";

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "autocommit-exec-"));
    run("git", ["init"], repoDir);
    run("git", ["config", "user.email", "test@example.com"], repoDir);
    run("git", ["config", "user.name", "Test User"], repoDir);
    writeFile(path.join(repoDir, "README.md"), "base\n");
    run("git", ["add", "--", "README.md"], repoDir);
    run("git", ["commit", "-m", "chore: init"], repoDir);

    process.env.XDG_STATE_HOME = fs.mkdtempSync(
      path.join(os.tmpdir(), "autocommit-xdg-"),
    );
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("creates a commit for allowed changed file", async () => {
    writeFile(path.join(repoDir, "src", "ok.txt"), "hello\n");

    const mod = await import("../src/autocommit.js");
    const tool = mod.default;

    const resRaw = await tool.execute(
      {
        type: "chore",
        message: "add ok file",
        files: ["src/ok.txt"],
      },
      {} as any,
    );
    const res = JSON.parse(resRaw) as { ok: boolean; head?: string };
    expect(res.ok).toBe(true);
    expect(typeof res.head).toBe("string");

    const log = run("git", ["log", "-1", "--pretty=%s"], repoDir);
    expect(log.stdout.trim()).toBe("chore: add ok file");
  });

  it("refuses when index has staged files outside requested set", async () => {
    writeFile(path.join(repoDir, "a.txt"), "a\n");
    writeFile(path.join(repoDir, "b.txt"), "b\n");
    run("git", ["add", "--", "b.txt"], repoDir);

    const mod = await import("../src/autocommit.js");
    const tool = mod.default;
    const resRaw = await tool.execute(
      {
        type: "chore",
        message: "try partial",
        files: ["a.txt"],
      },
      {} as any,
    );
    const res = JSON.parse(resRaw) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("index has staged files outside requested set");
  });

  it("refuses when all requested files are denied", async () => {
    writeFile(path.join(repoDir, ".aws", "credentials"), "fake\n");

    const mod = await import("../src/autocommit.js");
    const tool = mod.default;
    const resRaw = await tool.execute(
      {
        type: "chore",
        message: "should be denied",
        files: [".aws/credentials"],
      },
      {} as any,
    );
    const res = JSON.parse(resRaw) as { ok: boolean; reason?: string };
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("all requested files are denied by blacklist");
  });
});
