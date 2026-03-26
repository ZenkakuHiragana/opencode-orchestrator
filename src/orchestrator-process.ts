import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { buildOpencodeSpawnPlan } from "./opencode-spawn.js";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runOpencode(
  args: string[],
  logFile?: string,
  mirrorToStdout: boolean = true,
  extraEnv?: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const opencodeBin = process.env.OPENCODE_BIN || "opencode";
    const spawnPlan = buildOpencodeSpawnPlan(opencodeBin, args);
    const spawnOpts: Parameters<typeof spawn>[2] = {
      shell: spawnPlan.shell,
      stdio: ["inherit", "pipe", "pipe"],
      windowsVerbatimArguments: spawnPlan.windowsVerbatimArguments,
    };
    if (extraEnv) {
      spawnOpts.env = { ...process.env, ...extraEnv };
    }
    const child = spawn(spawnPlan.command, spawnPlan.args, spawnOpts);

    let stdout = "";
    let stderr = "";
    const logStream = logFile
      ? fs.createWriteStream(logFile, { encoding: "utf8" })
      : null;

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout += text;
        if (mirrorToStdout) {
          process.stdout.write(text);
        }
        if (logStream) logStream.write(text);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        if (mirrorToStdout) {
          process.stderr.write(text);
        }
        if (logStream) logStream.write(text);
      });
    }

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
