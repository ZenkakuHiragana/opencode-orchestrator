#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

import { parseLoopArgs, parseListArgs } from "./cli-args.js";
import {
  runLoop,
  enforceCommandPolicyGate,
  buildFileArgs,
} from "./orchestrator-loop.js";
import { runList } from "./orchestrator-list.js";
import { parseAuditResult } from "./orchestrator-audit.js";

// Re-export CLI helpers for tests and external callers that historically
// imported everything from cli.ts.
export { parseLoopArgs, parseListArgs } from "./cli-args.js";
export {
  runLoop,
  enforceCommandPolicyGate,
  buildFileArgs,
} from "./orchestrator-loop.js";
export { runList } from "./orchestrator-list.js";
export { parseAuditResult } from "./orchestrator-audit.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const subcommand = args.shift();

  if (subcommand === "loop") {
    const opts = parseLoopArgs(args);
    const done = await runLoop(opts);
    // Mirror original shell script semantics: non-zero exit when the loop did
    // not reach a clear done state (for example MAX_LOOP reached or safety
    // restarts exhausted).
    if (!done && process.exitCode === undefined) {
      process.exitCode = 1;
    }
    return;
  }

  if (subcommand === "list") {
    const opts = parseListArgs(args);
    await runList(opts);
    return;
  }

  console.error(`[opencode-orchestrator] unknown subcommand: ${subcommand}`);
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.error(
    "Usage: opencode-orchestrator <subcommand> [options]\n" +
      "\n" +
      "Subcommands:\n" +
      '  loop  --task <task-name> [--session <ses_...> | --continue] [--commit] [--max-loop N] [--max-restarts M] [--file <path>] "prompt..."\n' +
      "  list  [--json]   List available orchestrator tasks",
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
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((err) => {
    console.error("[opencode-orchestrator] fatal error:", err?.message ?? err);
    process.exit(1);
  });
}
