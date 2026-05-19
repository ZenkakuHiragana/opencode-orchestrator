import type { ExecOptions } from "./cli-types.js";
import { pushSpecs, validateRelativePathSpec } from "./cli-parser-shared.js";

export function parseExecArgs(argv: string[]): ExecOptions {
  const allowFsRead: string[] = [];
  const allowFsWrite: string[] = [];
  const scriptArgs: string[] = [];
  let timeoutMs = 30000;
  let maxOutputBytes = 65536;
  let filePath: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-fs-read") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--allow-fs-read requires a path");
      }
      validateRelativePathSpec(next, "--allow-fs-read");
      pushSpecs(allowFsRead, next);
    } else if (arg === "--allow-fs-write") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--allow-fs-write requires a path");
      }
      validateRelativePathSpec(next, "--allow-fs-write");
      pushSpecs(allowFsWrite, next);
    } else if (arg === "--timeout") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--timeout requires a number");
      }
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--timeout must be a positive number");
      }
      timeoutMs = n;
    } else if (arg === "--max-output") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--max-output requires a number");
      }
      const n = Number(next);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--max-output must be a positive number");
      }
      maxOutputBytes = n;
    } else if (arg === "--file") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--file requires a path");
      }
      filePath = next;
    } else if (arg === "--arg") {
      const next = argv[++i];
      if (!next) {
        throw new Error("--arg requires a value");
      }
      scriptArgs.push(next);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option for exec: ${arg}`);
    } else {
      rest.push(arg);
    }
  }

  if (filePath && rest.length > 0) {
    throw new Error("--file cannot be combined with inline helper source text");
  }

  return {
    allowFsRead,
    allowFsWrite,
    timeoutMs,
    maxOutputBytes,
    filePath,
    scriptSource: filePath ? "" : rest.join(" "),
    scriptArgs,
  };
}
