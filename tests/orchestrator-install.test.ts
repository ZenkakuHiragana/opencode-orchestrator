import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";

import { parseInstallArgs, runInstall } from "../src/orchestrator-install.js";

describe("orchestrator-install", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("parses --scope correctly", () => {
    const opts = parseInstallArgs(["--scope", "local"]);
    expect(opts.scope).toBe("local");

    const opts2 = parseInstallArgs(["--scope=global"]);
    expect(opts2.scope).toBe("global");
  });

  it("throws when scope is missing", () => {
    expect(() => parseInstallArgs([])).toThrow(
      "--scope must be specified as 'local' or 'global'",
    );
  });

  it("creates a new local config when none exists", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-install-local-"),
    );
    const cwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const target = path.join(tmpDir, "opencode.json");
      expect(fs.existsSync(target)).toBe(false);

      await runInstall({ scope: "local" });

      expect(fs.existsSync(target)).toBe(true);
      const json = JSON.parse(fs.readFileSync(target, "utf8"));
      expect(json.plugin).toEqual(["@zenorg/opencode-orchestrator"]);
      expect(json.permission.bash["*"]).toBe("ask");
    } finally {
      process.chdir(cwd);
    }
  });

  it("updates existing config by appending plugin only when file exists", async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "orch-install-update-"),
    );
    const cwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const target = path.join(tmpDir, "opencode.json");
      fs.writeFileSync(
        target,
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugin: ["foo-plugin"],
            permission: {
              bash: {
                "*": "allow",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      await runInstall({ scope: "local" });

      const json = JSON.parse(fs.readFileSync(target, "utf8"));
      expect(json.plugin).toEqual([
        "foo-plugin",
        "@zenorg/opencode-orchestrator",
      ]);
      // 既存の permission.bash は変更されない
      expect(json.permission.bash["*"]).toBe("allow");
    } finally {
      process.chdir(cwd);
    }
  });
});
