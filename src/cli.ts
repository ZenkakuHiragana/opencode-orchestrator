#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

import {
  parseLoopArgs,
  parseListArgs,
  parseExecArgs,
  printLoopUsage,
  printExecUsage,
  printListUsage,
} from "./cli-args.js";
import {
  runLoop,
  enforceCommandPolicyGate,
  buildFileArgs,
} from "./orchestrator-loop.js";
import { runList } from "./orchestrator-list.js";
import { runExec } from "./exec-runner.js";
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
import { t } from "./i18n/messages.js";
import { runRunCommand } from "./orchestrator-run.js";
import { runResumeCommand } from "./orchestrator-resume.js";
import { runStatusCommand } from "./orchestrator-status.js";
import { runDoctorCommand } from "./orchestrator-doctor.js";
import { runFixCommand } from "./orchestrator-fix.js";
import {
  runCompletionCommand,
  runCompleteCommand,
} from "./orchestrator-completion.js";

export { parseLoopArgs, parseListArgs, parseExecArgs } from "./cli-args.js";
export { printLoopUsage, printListUsage, printExecUsage } from "./cli-args.js";
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
    subcommand !== "exec" &&
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
    if (subcommand === "exec") {
      printExecUsage();
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

  if (actualSubcommand === "exec") {
    const opts = parseExecArgs(args);
    const result = await runExec(opts);
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    return result.code === 0 ? 0 : 1;
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

  if (actualSubcommand === "run") {
    const exitCode = await runRunCommand({ argv: args });
    return exitCode;
  }

  if (actualSubcommand === "resume") {
    const exitCode = await runResumeCommand({ argv: args });
    return exitCode;
  }

  if (actualSubcommand === "status") {
    const exitCode = await runStatusCommand({ argv: args });
    return exitCode;
  }

  if (actualSubcommand === "doctor") {
    const exitCode = await runDoctorCommand({ argv: args });
    return exitCode;
  }

  if (actualSubcommand === "fix") {
    const exitCode = await runFixCommand({ argv: args });
    return exitCode;
  }

  if (actualSubcommand === "completion") {
    const exitCode = await runCompletionCommand({ argv: args });
    return exitCode;
  }

  if (actualSubcommand === "__complete") {
    const exitCode = await runCompleteCommand({ argv: args });
    return exitCode;
  }

  console.error(
    t("cli.root.unknown_subcommand", {
      subcommand: String(actualSubcommand ?? ""),
    }),
  );
  printUsage();
  return 1;
}

function printUsage() {
  console.error(t("cli.root.usage"));
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
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as Error).message)
          : String(err);
      console.error(
        t("cli.root.fatal_error", {
          message,
        }),
      );
      process.exit(1);
    });
}
