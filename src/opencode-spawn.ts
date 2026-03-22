import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type OpencodeSpawnPlan = {
  command: string;
  args: string[];
  shell: boolean;
  windowsVerbatimArguments?: boolean;
};

function buildNodeScriptPlan(
  scriptPath: string,
  argv: string[],
): OpencodeSpawnPlan {
  const execBase = path.basename(process.execPath).toLowerCase();
  const nodeBin =
    execBase === "node" || execBase === "node.exe" ? process.execPath : "node";

  return {
    command: nodeBin,
    args: [scriptPath, ...argv],
    shell: false,
  };
}

function deriveOpencodeScriptFromShim(shimPath: string): string | null {
  const scriptPath = path.join(
    path.dirname(shimPath),
    "node_modules",
    "opencode-ai",
    "bin",
    "opencode",
  );
  return fs.existsSync(scriptPath) ? scriptPath : null;
}

function resolveWindowsOpencodeScript(opencodeBin: string): string | null {
  if (/\.(?:c|m)?js$/iu.test(opencodeBin) && fs.existsSync(opencodeBin)) {
    return opencodeBin;
  }

  if (path.isAbsolute(opencodeBin) && fs.existsSync(opencodeBin)) {
    return opencodeBin;
  }

  const candidateNames = new Set<string>();
  candidateNames.add(opencodeBin);
  if (!/\.cmd$/iu.test(opencodeBin)) {
    candidateNames.add(`${opencodeBin}.cmd`);
  }

  if (path.isAbsolute(opencodeBin)) {
    const derived = deriveOpencodeScriptFromShim(opencodeBin);
    if (derived) return derived;
  }

  for (const name of candidateNames) {
    try {
      const probe = spawnSync("where", [name], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (probe.status !== 0) continue;

      const paths = probe.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      for (const located of paths) {
        const derived = deriveOpencodeScriptFromShim(located);
        if (derived) return derived;
      }
    } catch {
      // fall through to cmd.exe fallback
    }
  }

  return null;
}

export function buildOpencodeSpawnPlan(
  opencodeBin: string,
  argv: string[],
  platform = process.platform,
  comspecOverride?: string,
): OpencodeSpawnPlan {
  if (platform === "win32") {
    const scriptPath = resolveWindowsOpencodeScript(opencodeBin);
    if (scriptPath) {
      return buildNodeScriptPlan(scriptPath, argv);
    }

    const comspec = comspecOverride || process.env.comspec || "cmd.exe";
    return {
      command: comspec,
      args: ["/d", "/s", "/c", opencodeBin, ...argv],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: opencodeBin,
    args: argv,
    shell: false,
  };
}
