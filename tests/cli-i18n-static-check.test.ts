import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";
import { describe, it, expect } from "vitest";

// NOTE: These tests assume a Node-like runtime where __dirname exists.
declare const __dirname: string;

// Core CLI-facing modules that should not embed Japanese user-facing
// messages directly. Localized strings for these surfaces must live in the
// i18n catalogue (src/i18n/messages.*.ts).
const CORE_CLI_MODULES = [
  "../src/cli.ts",
  "../src/cli-args.ts",
  "../src/orchestrator-run.ts",
  "../src/orchestrator-resume.ts",
  "../src/orchestrator-status.ts",
  "../src/orchestrator-doctor.ts",
  "../src/orchestrator-fix.ts",
  "../src/orchestrator-clear.ts",
];

describe("CLI i18n static check", () => {
  it("does not contain inline Japanese string literals in core CLI modules", () => {
    const japanesePattern = /[\u3040-\u30ff\u4e00-\u9fff]/;

    const offending: { file: string; text: string }[] = [];

    for (const rel of CORE_CLI_MODULES) {
      const fullPath = path.join(__dirname, rel);
      const source = fs.readFileSync(fullPath, "utf8");

      const file = ts.createSourceFile(
        path.basename(fullPath),
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );

      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node)) {
          if (japanesePattern.test(node.text)) {
            offending.push({ file: path.basename(fullPath), text: node.text });
          }
        }
        ts.forEachChild(node, visit);
      };

      ts.forEachChild(file, visit);
    }

    expect(offending).toEqual([]);
  });

  it("does not embed internal filenames in non-whitelisted CLI modules", () => {
    const internalTokens = [
      "command-policy.json",
      "status.json",
      "proposals.json",
      "loop_status",
      "env_blocked",
    ];

    const projectRoot = path.join(__dirname, "..");
    const srcRoot = path.join(projectRoot, "src");

    const allowlist = new Set<string>([
      "src/orchestrator-loop.ts",
      "src/orchestrator-session.ts",
      "src/orchestrator-steps.ts",
      "src/orchestrator-proposals.ts",
      "src/orchestrator-prompts.ts",
      "src/orchestrator-paths.ts",
      "src/preflight-cli.ts",
      "src/index.ts",
      "src/cli-args.ts",
      "src/orchestrator-agents.ts",
      "src/orchestrator-todo.ts",
      "src/orchestrator-clear.ts",
      "src/orchestrator-list.ts",
      "src/orchestrator-run.ts",
      "src/orchestrator-resume.ts",
      "src/orchestrator-status.ts",
      "src/orchestrator-fix.ts",
      "src/task-resolution.ts",
    ]);

    const offending: { file: string; token: string }[] = [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "i18n") continue;
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const rel = path.relative(projectRoot, full).replace(/\\/g, "/");
          if (allowlist.has(rel as any)) continue;
          const content = fs.readFileSync(full, "utf8");
          for (const token of internalTokens) {
            if (content.includes(token)) {
              offending.push({ file: rel, token });
            }
          }
        }
      }
    };

    walk(srcRoot);

    expect(offending).toEqual([]);
  });
});
