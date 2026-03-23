#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

import {
  parseLoopArgs,
  parseListArgs,
  printLoopUsage,
  printListUsage,
} from "./cli-args.js";
import {
  runLoop,
  enforceCommandPolicyGate,
  buildFileArgs,
} from "./orchestrator-loop.js";
import { runList } from "./orchestrator-list.js";
import { parseAuditResult } from "./orchestrator-audit.js";

export { parseLoopArgs, parseListArgs } from "./cli-args.js";
export { printLoopUsage, printListUsage } from "./cli-args.js";
export {
  runLoop,
  enforceCommandPolicyGate,
  buildFileArgs,
} from "./orchestrator-loop.js";
export { runList } from "./orchestrator-list.js";
export { parseAuditResult } from "./orchestrator-audit.js";

function readPackageVersion(): string {
  const pkg = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { version?: string };
  return String(pkg.version ?? "").trim();
}

export async function runCli(argv: string[]): Promise<number> {
  const args = [...argv];

  if (args.length === 0) {
    printUsage();
    return 1;
  }

  const subcommand = args[0];

  // Root-level --help/--version (no subcommand)
  if (subcommand !== "loop" && subcommand !== "list") {
    if (args.includes("--help") || args.includes("-h")) {
      printUsage();
      return 0;
    }
    if (args.includes("--version") || args.includes("-v")) {
      console.error(readPackageVersion());
      return 0;
    }
  }

  // Subcommand-specific help (e.g. "loop --help")
  if (args.includes("--help") || args.includes("-h")) {
    if (subcommand === "loop") {
      printLoopUsage();
      return 0;
    }
    if (subcommand === "list") {
      printListUsage();
      return 0;
    }
  }

  // Root-level version for known subcommands
  if (args.includes("--version") || args.includes("-v")) {
    console.error(readPackageVersion());
    return 0;
  }

  const actualSubcommand = args.shift();

  if (actualSubcommand === "loop") {
    const opts = parseLoopArgs(args);
    const done = await runLoop(opts);
    return done ? 0 : 1;
  }

  if (actualSubcommand === "list") {
    const opts = parseListArgs(args);
    await runList(opts);
    return 0;
  }

  console.error(
    `[opencode-orchestrator] unknown subcommand: ${actualSubcommand}`,
  );
  printUsage();
  return 1;
}

function printUsage() {
  console.error(
    "Usage: opencode-orchestrator <subcommand> [options]\n" +
      "\n" +
      "Subcommands:\n" +
      '  loop  --task <task-name> [--session <ses_...> | --continue] [--commit] [--max-loop N] [--max-restarts M] [--file <path>] "prompt..."\n' +
      "  list  [--json]   List available orchestrator tasks\n" +
      "\n" +
      "Options:\n" +
      "  -h, --help       Show this help message\n" +
      "  -v, --version    Show version number\n",
  );
}

function isDirectCliInvocation(): boolean {
  if (!process.argv[1]) return false;
  try {
    const cliPath = fileURLToPath(import.meta.url);
    const argPath = fs.realpathSync(process.argv[1]);
    return cliPath === argPath;
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(
        "[opencode-orchestrator] fatal error:",
        err?.message ?? err,
      );
      process.exit(1);
    });
}
