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
import {
  parseClearArgs,
  printClearUsage,
  runClear,
} from "./orchestrator-clear.js";
import {
  parseInstallArgs,
  printInstallUsage,
  runInstall,
} from "./orchestrator-install.js";
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
export {
  parseClearArgs,
  printClearUsage,
  runClear,
} from "./orchestrator-clear.js";
export {
  parseInstallArgs,
  printInstallUsage,
  runInstall,
} from "./orchestrator-install.js";

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
  if (
    subcommand !== "loop" &&
    subcommand !== "list" &&
    subcommand !== "clear" &&
    subcommand !== "install"
  ) {
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
    if (subcommand === "clear") {
      printClearUsage();
      return 0;
    }
    if (subcommand === "install") {
      printInstallUsage();
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

  if (actualSubcommand === "clear") {
    const opts = parseClearArgs(args);
    await runClear(opts);
    return 0;
  }

  if (actualSubcommand === "install") {
    const opts = parseInstallArgs(args);
    await runInstall(opts);
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
    "使い方: opencode-orchestrator <subcommand> [options]\n" +
      "\n" +
      "サブコマンド:\n" +
      '  loop  --task <task-name> [--session <ses_...> | --continue] [--commit] [--max-loop N] [--max-restarts M] [--file <path>] "prompt..."\n' +
      "  list  [--json]   orchestrator タスク一覧または proposal 一覧を表示\n" +
      "  clear --task <task-name> --proposals [-y]   指定タスクの proposal を削除\n" +
      "  install --scope <local|global>   OpenCode 設定ファイルにプラグインを追加\n" +
      "\n" +
      "共通オプション:\n" +
      "  -h, --help       このヘルプを表示\n" +
      "  -v, --version    バージョン番号を表示\n",
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
