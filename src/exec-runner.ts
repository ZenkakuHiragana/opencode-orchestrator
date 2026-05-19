import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExecOptions } from "./cli-args.js";
import { assertExecHelperSourceIsSafe } from "./exec-ast-check.js";
import { t } from "./i18n/messages.js";

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) =>
      chunks.push(Buffer.from(chunk)),
    );
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", reject);
  });
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

function getPermissionFlag(): string {
  const major = Number(process.versions.node.split(".")[0] ?? "0");
  if (!Number.isFinite(major) || major < 20) {
    throw new Error("exec requires Node.js 20 or newer");
  }
  return major >= 24 ? "--permission" : "--experimental-permission";
}

function normalizePathSpecs(specs: string[]): string[] {
  const out = new Set<string>();
  for (const spec of specs) {
    if (path.isAbsolute(spec) || /^[A-Za-z]:/.test(spec)) {
      throw new Error(`exec path spec must be workspace-relative: ${spec}`);
    }

    const normalized = spec.replace(/\\/g, "/");
    for (const segment of normalized.split("/")) {
      if (segment === "..") {
        throw new Error(
          `exec path spec must not contain .. traversal: ${spec}`,
        );
      }
    }

    out.add(path.resolve(spec));
  }
  return [...out];
}

function detectHelperSource(opts: ExecOptions): {
  hasFile: boolean;
  hasInline: boolean;
  isPipedStdin: boolean;
} {
  const hasFile = !!opts.filePath;
  const hasInline = !!opts.scriptSource;
  const isPipedStdin =
    !process.stdin.isTTY && process.stdin.isTTY !== undefined;
  return { hasFile, hasInline, isPipedStdin };
}

function buildCombinedScript(source: string, scriptArgs: string[]): string {
  const argvJson = JSON.stringify(Object.freeze([...scriptArgs]));
  return [
    'import * as __fs from "node:fs/promises";',
    'import * as __path from "node:path";',
    `const argv = Object.freeze(${argvJson});`,
    "const stdout = process.stdout;",
    "const stderr = process.stderr;",
    'const readText = (filePath) => __fs.readFile(filePath, "utf8");',
    'const writeText = (filePath, content) => __fs.writeFile(filePath, content, "utf8");',
    "const readJson = (filePath) => readText(filePath).then((t) => JSON.parse(t));",
    'const writeJson = (filePath, data) => writeText(filePath, JSON.stringify(data, null, 2) + "\\n");',
    "const stdinText = () => new Promise((resolve, reject) => {",
    "  const chunks = [];",
    '  process.stdin.setEncoding("utf8");',
    '  process.stdin.on("data", (chunk) => chunks.push(chunk));',
    '  process.stdin.on("end", () => resolve(chunks.join("")));',
    '  process.stdin.on("error", reject);',
    "});",
    "const __helper = async () => {",
    source,
    "};",
    "await __helper();",
  ].join("\n");
}

export async function runExec(opts: ExecOptions): Promise<ExecResult> {
  const { hasFile, hasInline, isPipedStdin } = detectHelperSource(opts);

  if (!hasFile && !hasInline && !isPipedStdin) {
    throw new Error(
      "exec requires helper source via positional argument, --file, or stdin",
    );
  }
  if (hasFile && hasInline) {
    throw new Error("--file cannot be combined with inline helper source text");
  }

  let source: string;
  let stdinPayload: string | undefined;

  if (hasFile) {
    source = await fs.readFile(opts.filePath!, "utf8");
  } else if (hasInline) {
    source = opts.scriptSource;
  } else {
    source = await readAllStdin();
    stdinPayload = source;
  }

  assertExecHelperSourceIsSafe(source);

  const permissionFlag = getPermissionFlag();
  const readSpecs = normalizePathSpecs(opts.allowFsRead);
  const writeSpecs = normalizePathSpecs(opts.allowFsWrite);

  const env = { ...process.env };

  const combinedScript = buildCombinedScript(source, opts.scriptArgs);
  const childArgs = [permissionFlag];
  for (const spec of readSpecs) {
    childArgs.push(`--allow-fs-read=${spec}`);
  }
  for (const spec of writeSpecs) {
    childArgs.push(`--allow-fs-write=${spec}`);
  }
  childArgs.push("--input-type=module", "--eval", combinedScript);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    if (stdinPayload !== undefined) {
      child.stdin.end(stdinPayload);
    } else {
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let reportedMaxOutput = false;

    const appendMaxOutputError = () => {
      if (reportedMaxOutput) return;
      reportedMaxOutput = true;
      stderr += t("cli.exec.error.max_output", {
        maxOutputBytes: String(opts.maxOutputBytes),
      });
    };

    const timeoutId = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      stderr += t("cli.exec.error.timeout", {
        timeoutMs: String(opts.timeoutMs),
      });
      child.kill();
    }, opts.timeoutMs);

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (settled) return;
      const limit = opts.maxOutputBytes;
      const remaining = limit - totalBytes;
      if (remaining <= 0) {
        truncated = true;
        appendMaxOutputError();
        child.kill();
        return;
      }
      const slice = chunk.subarray(0, Math.min(remaining, chunk.length));
      totalBytes += slice.length;
      if (target === "stdout") {
        stdout += slice.toString("utf8");
      } else {
        stderr += slice.toString("utf8");
      }
      if (slice.length < chunk.length) {
        truncated = true;
        appendMaxOutputError();
        child.kill();
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      settled = true;
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      clearTimeout(timeoutId);
      settled = true;
      resolve({ code: timedOut ? null : code, stdout, stderr, truncated });
    });
  });
}
