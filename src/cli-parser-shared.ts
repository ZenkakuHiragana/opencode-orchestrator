import path from "node:path";

import { getCliOptionSpecs, type CliSubcommand } from "./cli-contract.js";
import { t } from "./i18n/messages.js";
import type { HighLevelLoopWrapperOptions } from "./cli-types.js";

export function validateRelativePathSpec(spec: string, flag: string): void {
  if (path.isAbsolute(spec) || /^[A-Za-z]:/.test(spec)) {
    throw new Error(
      `${flag} must be a workspace-relative path or glob: ${spec}`,
    );
  }

  const normalized = spec.replace(/\\/g, "/");
  for (const segment of normalized.split("/")) {
    if (segment === "..") {
      throw new Error(`${flag} must not contain .. path traversal: ${spec}`);
    }
  }
}

export function throwUnknownHighLevelOption(
  subcommand: string,
  option: string,
): never {
  throw new Error(
    t("cli.highlevel.error.unknown_option", {
      subcommand,
      option,
    }),
  );
}

export function throwUnexpectedHighLevelArg(
  subcommand: string,
  arg: string,
): never {
  throw new Error(
    t("cli.highlevel.error.unexpected_arg", {
      subcommand,
      arg,
    }),
  );
}

export function throwUnsupportedHighLevelOption(
  subcommand: string,
  option: string,
): never {
  throw new Error(
    t("cli.highlevel.error.unsupported_option", {
      subcommand,
      option,
    }),
  );
}

const unsupportedHighLevelLoopOptions = new Set(["--session", "--continue"]);

export function getHighLevelLoopOptionSets(subcommand: CliSubcommand): {
  withValue: Set<string>;
  withoutValue: Set<string>;
} {
  const specs = getCliOptionSpecs(subcommand).filter(
    (spec) => !unsupportedHighLevelLoopOptions.has(spec.value),
  );
  return {
    withValue: new Set(
      specs.filter((spec) => spec.takesValue).map((spec) => spec.value),
    ),
    withoutValue: new Set(
      specs.filter((spec) => !spec.takesValue).map((spec) => spec.value),
    ),
  };
}

export function parseHighLevelLoopWrapperArgs(
  argv: string[],
  subcommand: "run" | "resume",
): HighLevelLoopWrapperOptions {
  const loopArgv = [...argv];
  let task: string | undefined;
  let bwrapSkipCommandPolicy = false;
  const { withValue, withoutValue } = getHighLevelLoopOptionSets(subcommand);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (unsupportedHighLevelLoopOptions.has(arg)) {
      throwUnsupportedHighLevelOption(subcommand, arg);
    }

    if (arg === "--") {
      throwUnexpectedHighLevelArg(subcommand, argv[i + 1] ?? arg);
    }

    if (arg === "--task" || arg === "-t") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--task requires a task name");
      }
      task = next;
    } else if (withValue.has(arg)) {
      const next = argv[++i];
      if (!next) {
        if (arg === "--bwrap-arg") {
          throw new Error("--bwrap-arg requires an argument");
        }
        if (arg === "--file" || arg === "-f") {
          throw new Error("--file requires a file path");
        }
        if (arg === "--task" || arg === "-t") {
          throw new Error("--task requires a task name");
        }
        throw new Error(`${arg} requires a number`);
      }
    } else if (withoutValue.has(arg)) {
      if (arg === "--bwrap-skip-command-policy") {
        bwrapSkipCommandPolicy = true;
      }
    } else if (bwrapSkipCommandPolicy && arg.startsWith("-")) {
    } else if (arg.startsWith("-")) {
      throwUnknownHighLevelOption(subcommand, arg);
    } else {
      throwUnexpectedHighLevelArg(subcommand, arg);
    }
  }

  return { task, loopArgv };
}

export function pushSpecs(target: string[], value: string): void {
  for (const item of value.split(",")) {
    const trimmed = item.trim();
    if (trimmed) target.push(trimmed);
  }
}
