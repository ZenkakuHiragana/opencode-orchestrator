import * as fs from "node:fs";
import { spawnSync } from "node:child_process";

import { t } from "./i18n/messages.js";
import { getOrchestratorBaseDir } from "./orchestrator-paths.js";

export interface DoctorCommandOptions {
  argv: string[];
}

interface ToolCheckResult {
  name: string;
  ok: boolean;
}

function checkTool(name: string, args: string[]): ToolCheckResult {
  const result = spawnSync(name, args, { stdio: "ignore" });
  return { name, ok: result.status === 0 };
}

export async function runDoctorCommand(
  opts: DoctorCommandOptions,
): Promise<number> {
  void opts;

  const checks: ToolCheckResult[] = [];

  checks.push(checkTool("node", ["--version"]));
  checks.push(checkTool("npm", ["--version"]));
  checks.push(checkTool("npx", ["--version"]));
  checks.push(checkTool("opencode", ["--version"]));

  let hasError = false;

  const missing = checks.filter((c) => !c.ok).map((c) => c.name);

  if (missing.length === 0) {
    console.error(t("cli.doctor.info.tools_ok"));
  } else {
    console.error(
      t("cli.doctor.error.missing_tools", {
        tools: missing.join(", "),
      }),
    );
    hasError = true;
  }

  const baseDir = getOrchestratorBaseDir();
  try {
    const stat = fs.statSync(baseDir);
    if (!stat.isDirectory()) {
      console.error(t("cli.doctor.error.state_base_missing"));
      hasError = true;
    } else {
      try {
        fs.accessSync(baseDir, fs.constants.W_OK);
      } catch {
        console.error(t("cli.doctor.warn.state_base_not_writable"));
        hasError = true;
      }
    }
  } catch {
    console.error(t("cli.doctor.error.state_base_missing"));
    hasError = true;
  }

  return hasError ? 1 : 0;
}
