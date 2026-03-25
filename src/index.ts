import type { Plugin } from "@opencode-ai/plugin";
import autocommit from "./autocommit.js";
import preflightCli from "./preflight-cli.js";
import { orchTodoReadTool, orchTodoWriteTool } from "./orchestrator-todo.js";
import { setOpencodeClient } from "./opencode-client-store.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { orchestratorAgents } from "./orchestrator-agents.js";
import { orchestratorCommands } from "./orchestrator-commands.js";
import {
  rewriteAgentConfigPaths,
  rewritePromptPaths,
} from "./orchestrator-paths.js";
import { loadMarkdownBody } from "./markdown.js";

export const OrchestratorPlugin: Plugin = async (input) => {
  // Store the OpenCode client so that tools can call the API directly
  // (e.g. tui.showToast for toast notifications).
  setOpencodeClient(input.client);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const baseDir = path.dirname(__dirname);
  const agentsDir = path.join(baseDir, "agents");
  const commandsDir = path.join(baseDir, "commands");
  const schemaDir = path.join(baseDir, "resources");

  const loadJsonSchema = (name: string): string | undefined => {
    const fullPath = path.join(schemaDir, `${name}.json`);
    if (!fs.existsSync(fullPath)) return undefined;
    return fs.readFileSync(fullPath, "utf8");
  };

  const schemaCache: Record<string, string | undefined> = {
    "acceptance-index": loadJsonSchema("acceptance-index"),
    "command-policy": loadJsonSchema("command-policy"),
    "helper-commands": loadJsonSchema("helper-commands"),
  };

  const schemaPlaceholderMap: Record<string, keyof typeof schemaCache> = {
    // JSON schema for acceptance-index.json (for reference only).
    $ACCEPTANCE_INDEX_SCHEMA: "acceptance-index",
    // JSON schema for command-policy.json (for reference only).
    $COMMAND_POLICY_SCHEMA: "command-policy",
    // Predefined helper commands (for shell composition).
    $HELPER_COMMANDS_SCHEMA: "helper-commands",
  } as const;

  const expandSchemaPlaceholders = (
    body: string | undefined,
  ): string | undefined => {
    if (!body) return body;
    let out = body;
    for (const [placeholder, key] of Object.entries(schemaPlaceholderMap)) {
      const schemaBody = schemaCache[key];
      if (!schemaBody) continue;
      if (out.includes(placeholder)) {
        out = out.split(placeholder).join(schemaBody.trim());
      }
    }
    return out;
  };

  // NOTE: We intentionally type this as `any` so that we can conditionally
  // extend the tool set without fighting the strict Tool registry type. At
  // runtime the shape is still `{ [name: string]: Tool }`.
  const tools: any = {
    autocommit,
    orch_todo_read: orchTodoReadTool,
    orch_todo_write: orchTodoWriteTool,
    "preflight-cli": preflightCli,
  };

  return {
    tool: tools,
    config: async (config: any) => {
      if (!config.agent) {
        config.agent = {};
      }
      if (!config.command) {
        config.command = {};
      }

      // Per-agent visibility control for non-orchestrator agents (e.g. the
      // built-in `build` agent). When an agent's key is absent or set to
      // false, its description is cleared so the task tool shows the generic
      // "call manually" fallback instead of a useful description that
      // encourages proactive use.
      //
      // Config shape:
      //   { "permission": { "orchestrator": { "orch-local-investigator": "allow" } } }
      const orchestratorPermissionMap: Record<string, string> =
        typeof config.permission?.orchestrator === "object" &&
        config.permission?.orchestrator !== null
          ? config.permission.orchestrator
          : {};

      // Wire orchestrator agents: metadata from TypeScript, prompt body from
      // agents/<name>.md with any frontmatter stripped.
      for (const [name, meta] of Object.entries(orchestratorAgents)) {
        const bodyPath = path.join(agentsDir, `${name}.md`);
        let prompt: string | undefined;
        if (fs.existsSync(bodyPath)) {
          const raw = loadMarkdownBody(bodyPath);
          prompt = rewritePromptPaths(raw);
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

        prompt = expandSchemaPlaceholders(prompt);

        const existing = config.agent[name] ?? {};

        // When the agent is not explicitly exposed, clear its description
        // so that non-orchestrator agents (e.g. build) see the generic
        // "call manually" fallback and are not encouraged to use them
        // proactively via the task tool.
        const shouldClearDescription =
          meta.description && orchestratorPermissionMap[name] !== "allow";

        // Merge order: TypeScript defaults first, then user overrides,
        // then always-set prompt. This lets users override any property
        // (description, hidden, mode, permission, …) via opencode.json.
        const metaForMerge = shouldClearDescription
          ? { ...meta, description: undefined }
          : meta;
        const merged = {
          ...metaForMerge,
          ...existing,
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
