import { spawn } from "node:child_process";
import * as fs from "node:fs";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runOpencode(
  args: string[],
  logFile?: string,
  mirrorToStdout: boolean = true,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Allow Windows callers to override the executable to `opencode.cmd`,
    // `pwsh`, or another launcher when plain `opencode` is not spawnable.
    const opencodeBin = process.env.OPENCODE_BIN || "opencode";
    const child = spawn(opencodeBin, args, {
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const logStream = logFile
      ? fs.createWriteStream(logFile, { encoding: "utf8" })
      : null;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (mirrorToStdout) {
        process.stdout.write(text);
      }
      if (logStream) logStream.write(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (mirrorToStdout) {
        process.stderr.write(text);
      }
      if (logStream) logStream.write(text);
    });

    child.on("error", (err) => {
      if (logStream) logStream.end();
      reject(err);
    });

    child.on("close", (code) => {
      if (logStream) logStream.end();
      resolve({ code, stdout, stderr });
    });
  });
}
