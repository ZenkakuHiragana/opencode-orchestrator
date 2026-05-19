import * as fs from "node:fs";
import * as path from "node:path";

import helperCommandsData from "../resources/helper-commands.json" with { type: "json" };
import { getOrchestratorStateDir } from "./orchestrator-paths.js";
import type { CommandUsage, PreflightProbeResult } from "./preflight-types.js";

export function truncateExcerpt(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export function refreshCommandPolicySummary(
  task: string,
  results: PreflightProbeResult[],
): void {
  const stateDir = getOrchestratorStateDir(task);
  const policyPath = path.join(stateDir, "command-policy.json");
  if (!fs.existsSync(policyPath)) {
    return;
  }

  const rawPolicy = fs.readFileSync(policyPath, "utf8");
  const policyJson = JSON.parse(rawPolicy) as {
    version?: number;
    summary?: {
      loop_status?: string;
      available_helper_commands?: string[];
    };
    commands?: {
      id?: string;
      usage?: CommandUsage | string;
      availability?: "available" | "unavailable";
      [key: string]: unknown;
    }[];
  };

  if (policyJson.version !== 1 || !Array.isArray(policyJson.commands)) {
    return;
  }

  const resultById = new Map<string, PreflightProbeResult>();
  for (const r of results) {
    resultById.set(r.id, r);
  }

  const availableHelperCommands = helperCommandsData.helper_commands
    .filter((helper) => {
      const r = resultById.get(helper.id);
      return r && r.available;
    })
    .map((helper) => helper.command);

  if (!policyJson.summary) {
    policyJson.summary = {};
  }
  policyJson.summary.available_helper_commands = availableHelperCommands;

  for (const cmd of policyJson.commands) {
    if (!cmd.id || cmd.id.startsWith("helper:")) continue;
    const r = resultById.get(cmd.id);
    if (!r) continue;
    cmd.availability = r.available ? "available" : "unavailable";
  }

  fs.writeFileSync(policyPath, JSON.stringify(policyJson, null, 2), "utf8");
}
