import {
  parseHighLevelLoopWrapperArgs,
  throwUnexpectedHighLevelArg,
  throwUnknownHighLevelOption,
} from "./cli-parser-shared.js";
import { t } from "./i18n/messages.js";
import { parseLoopArgs } from "./cli-loop-parser.js";
import type {
  CompletionCliOptions,
  DoctorOptions,
  HighLevelLoopWrapperOptions,
  TaskLookupOptions,
} from "./cli-types.js";

function parseTaskLookupArgs(
  argv: string[],
  subcommand: "status" | "fix",
): TaskLookupOptions {
  let task: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--task" || arg === "-t") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--task requires a task name");
      }
      task = next;
    } else if (arg.startsWith("-")) {
      throwUnknownHighLevelOption(subcommand, arg);
    } else {
      throwUnexpectedHighLevelArg(subcommand, arg);
    }
  }

  return { task };
}

export function parseRunArgs(argv: string[]): HighLevelLoopWrapperOptions {
  const parsed = parseHighLevelLoopWrapperArgs(argv, "run");
  parseLoopArgs(
    parsed.loopArgv.includes("--task")
      ? parsed.loopArgv
      : ["--task", parsed.task ?? "__task-placeholder__", ...parsed.loopArgv],
  );
  return parsed;
}

export function parseResumeArgs(argv: string[]): HighLevelLoopWrapperOptions {
  const parsed = parseHighLevelLoopWrapperArgs(argv, "resume");
  parseLoopArgs(
    parsed.loopArgv.includes("--task")
      ? parsed.loopArgv
      : ["--task", parsed.task ?? "__task-placeholder__", ...parsed.loopArgv],
  );
  return parsed;
}

export function parseStatusArgs(argv: string[]): TaskLookupOptions {
  return parseTaskLookupArgs(argv, "status");
}

export function parseFixArgs(argv: string[]): TaskLookupOptions {
  return parseTaskLookupArgs(argv, "fix");
}

export function parseDoctorArgs(argv: string[]): DoctorOptions {
  if (argv.length > 0) {
    const first = argv[0]!;
    if (first.startsWith("-")) {
      throwUnknownHighLevelOption("doctor", first);
    }
    throwUnexpectedHighLevelArg("doctor", first);
  }

  return { help: false };
}

export function parseCompletionCliArgs(argv: string[]): CompletionCliOptions {
  const shell = argv[0];
  if (!shell) {
    throw new Error(t("cli.completion.error.missing_shell"));
  }
  if (shell !== "bash" && shell !== "powershell") {
    throw new Error(
      t("cli.completion.error.unknown_shell", {
        shell,
      }),
    );
  }
  if (argv.length > 1) {
    throwUnexpectedHighLevelArg("completion", argv[1]!);
  }

  return { shell };
}
