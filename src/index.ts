import type { Plugin } from "@opencode-ai/plugin";
import autocommit from "./autocommit.js";
import preflightCli from "./preflight-cli.js";
import { orchTodoReadTool, orchTodoWriteTool } from "./orchestrator-todo.js";
import { setOpencodeClient } from "./opencode-client-store.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { orchestratorAgents } from "./orchestrator-agents.js";
import { orchestratorCommands } from "./orchestrator-commands.js";
import {
  rewriteAgentConfigPaths,
  rewritePromptPaths,
} from "./orchestrator-paths.js";

function loadMarkdownBody(fullPath: string): string {
  const text = fs.readFileSync(fullPath, "utf8");
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) {
      return text.slice(end + 4).trimStart();
    }
  }
  return text;
}

export const OrchestratorPlugin: Plugin = async (input) => {
  // Store the OpenCode client so that tools can call the API directly
  // (e.g. tui.showToast for toast notifications).
  setOpencodeClient(input.client);

  const baseDir = path.dirname(__dirname);
  const agentsDir = path.join(baseDir, "agents");
  const commandsDir = path.join(baseDir, "commands");
  const schemaDir = path.join(baseDir, "schema");

  const loadJsonSchema = (name: string): string | undefined => {
    const fullPath = path.join(schemaDir, `${name}.json`);
    if (!fs.existsSync(fullPath)) return undefined;
    return fs.readFileSync(fullPath, "utf8");
  };

  const schemaCache: Record<string, string | undefined> = {
    "acceptance-index": loadJsonSchema("acceptance-index"),
    "command-policy": loadJsonSchema("command-policy"),
  };

  // Detect when this plugin instance is running inside an `orch-preflight`
  // command session. In that case we must *not* register the `preflight-cli`
  // tool, otherwise subagents such as `orch-preflight-runner` could see and
  // call it, recreating recursive `opencode run --command orch-preflight`
  // chains. We intentionally keep this detection very simple and rely only on
  // process.argv so that it works even if agent-level tool permissions are
  // ignored by the runtime.
  const argv = process.argv ?? [];
  const isOrchPreflightCommand =
    argv.includes("orch-preflight") && argv.includes("--command");

  // NOTE: We intentionally type this as `any` so that we can conditionally
  // omit `preflight-cli` without fighting the strict Tool registry type. At
  // runtime the shape is still `{ [name: string]: Tool }`.
  const tools: any = {
    autocommit,
    orch_todo_read: orchTodoReadTool,
    orch_todo_write: orchTodoWriteTool,
  };
  if (!isOrchPreflightCommand) {
    tools["preflight-cli"] = preflightCli;
  }

  return {
    tool: tools,
    config: async (config: any) => {
      if (!config.agent) {
        config.agent = {};
      }
      if (!config.command) {
        config.command = {};
      }

      // Wire orchestrator agents: metadata from TypeScript, prompt body from
      // agents/<name>.md with any frontmatter stripped. This intentionally
      // overwrites any existing config.agent[<name>] so that the TypeScript
      // definition is the single source of truth.
      for (const [name, meta] of Object.entries(orchestratorAgents)) {
        const bodyPath = path.join(agentsDir, `${name}.md`);
        let prompt: string | undefined;
        if (fs.existsSync(bodyPath)) {
          const raw = loadMarkdownBody(bodyPath);
          prompt = rewritePromptPaths(raw);
        }

        // Attach shared JSON schema fragments to the end of the prompt when
        // relevant. This keeps acceptance-index/command-policy definitions in
        // schema/*.json as a single source of truth while still exposing them
        // to each orchestrator agent via a ```json code block.
        const schemaNames: string[] = [];
        if (name === "orch-refiner" || name === "orch-spec-checker") {
          schemaNames.push("acceptance-index", "command-policy");
        } else if (name === "orch-planner" || name === "orch-executor") {
          schemaNames.push("command-policy");
        }

        if (schemaNames.length > 0) {
          const parts: string[] = [];
          if (prompt) parts.push(prompt);
          for (const sName of schemaNames) {
            const body = schemaCache[sName];
            if (!body) continue;
            const label =
              sName === "acceptance-index"
                ? "JSON schema for acceptance-index.json"
                : "JSON schema for command-policy.json";
            parts.push(
              `${label} (for reference):\n\n` +
                "```json\n" +
                body.trim() +
                "\n```",
            );
          }
          prompt = parts.join("\n\n");
        }

        // For the auditor agent, also attach the effective bash permission map so that
        // the model can see exactly which commands are allowed/denied. This keeps the
        // permission.bash configuration in TypeScript as the single source of truth
        // while making the resulting policy visible inside the prompt.
        if (name === "orch-auditor") {
          const auditorMeta = orchestratorAgents["orch-auditor"] as any;
          const bashPerm =
            auditorMeta &&
            auditorMeta.permission &&
            auditorMeta.permission.bash;
          if (bashPerm && typeof bashPerm === "object") {
            const permsJson = JSON.stringify(bashPerm, null, 2);
            const block =
              "Current bash permission map for this agent (permission.bash):\n\n" +
              "```json\n" +
              permsJson +
              "\n```";
            prompt = prompt ? `${prompt}\n\n${block}` : block;
          }
        }

        const existing = config.agent[name] ?? {};
        const merged = {
          ...existing,
          ...meta,
          ...(prompt ? { prompt } : {}),
        };
        // Rewrite any $XDG_STATE_HOME/legacy state paths in both prompts and
        // permission patterns so that the final agent config only contains
        // absolute paths appropriate for this environment.
        config.agent[name] = rewriteAgentConfigPaths(merged);
      }

      // Wire orchestrator commands: metadata from TypeScript + markdown
      // template bodies from commands/<name>.md (frontmatter stripped). We
      // must provide a concrete `template` here because Config.command
      // requires it; relying on {file:...} expansion is not possible from the
      // plugin hook since the config loader has already run.
      for (const [name, meta] of Object.entries(orchestratorCommands)) {
        if (config.command[name]) continue;

        const bodyPath = path.join(commandsDir, `${name}.md`);
        let template: string;
        if (fs.existsSync(bodyPath)) {
          template = loadMarkdownBody(bodyPath);
        } else {
          // Fallback: minimal template that forwards arguments.
          template = meta.description
            ? `${meta.description}\n\n$ARGUMENTS`
            : "$ARGUMENTS";
        }

        config.command[name] = {
          template,
          description: meta.description,
          agent: meta.agent,
          subtask: meta.subtask,
        };
      }
    },
  };
};

export default OrchestratorPlugin;
