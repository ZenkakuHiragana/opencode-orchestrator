import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { t } from "./i18n/messages.js";
import { ORCHESTRATOR_SKILLS_DIRNAME } from "./orchestrator-skills.js";

export type InstallScope = "local" | "global";

export interface InstallOptions {
  scope: InstallScope;
}

const PLUGIN_NAME = "@zenorg/opencode-orchestrator";

export function printInstallUsage(): void {
  console.error(t("cli.install.usage"));
}

export function parseInstallArgs(argv: string[]): InstallOptions {
  // npm CLI と同様に、デフォルトはローカル、-g/--global でグローバル。
  let scope: InstallScope = "local";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-g" || arg === "--global") {
      scope = "global";
    } else if (arg === "--local") {
      scope = "local";
    } else if (arg === "--scope") {
      // 後方互換用のエイリアス: --scope local|global
      const next = argv[++i];
      if (!next) {
        throw new Error("--scope requires a value (local or global)");
      }
      if (next === "local" || next === "global") {
        scope = next;
      } else {
        throw new Error('--scope must be "local" or "global"');
      }
    } else if (arg.startsWith("--scope=")) {
      const value = arg.slice("--scope=".length);
      if (value === "local" || value === "global") {
        scope = value;
      } else {
        throw new Error('--scope must be "local" or "global"');
      }
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option for install: ${arg}`);
    } else {
      throw new Error(`unexpected argument for install: ${arg}`);
    }
  }

  return { scope };
}

function getGlobalConfigPath(): string {
  const homeDirectory = os.homedir();
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;

  const xdgConfig =
    xdgConfigHome && xdgConfigHome.trim() !== ""
      ? xdgConfigHome
      : homeDirectory
        ? path.join(homeDirectory, ".config")
        : (() => {
            throw new Error(
              "Cannot resolve XDG config directory for OpenCode (no home directory)",
            );
          })();

  const baseDir = path.join(xdgConfig, "opencode");
  return path.join(baseDir, "opencode.json");
}

function getLocalConfigPath(): string {
  return path.resolve(process.cwd(), "opencode.json");
}

function getPackagedSkillsPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const baseDir = path.dirname(__dirname);
  return path.join(baseDir, ORCHESTRATOR_SKILLS_DIRNAME);
}

function stripJsonc(input: string): string {
  let out = "";
  let inString = false;
  let stringChar: string | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
        stringChar = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") {
        i += 1;
      }
      if (i < input.length) {
        out += "\n";
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length) {
        if (input[i] === "*" && i + 1 < input.length && input[i + 1] === "/") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += ch;
  }

  return out.replace(/,\s*([}\]])/g, "$1");
}

function readConfigFile(filePath: string): any | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    const cleaned = stripJsonc(raw);
    const parsed = JSON.parse(cleaned) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch (err) {
    console.error(
      t("cli.install.error.invalid_config", {
        path: filePath,
      }),
    );
    console.error(t("cli.install.error.invalid_config_hint"));
    throw err;
  }
}

function matchesPluginName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let v = value.trim();
  if (!v) return false;

  // Allow npm: prefix (npm:@zenorg/opencode-orchestrator@latest)
  if (v.startsWith("npm:")) {
    v = v.slice("npm:".length);
  }

  if (v === PLUGIN_NAME) {
    return true;
  }

  // Treat @zenorg/opencode-orchestrator@version or @zenorg/opencode-orchestrator@tag as same plugin
  if (v.startsWith(PLUGIN_NAME + "@")) {
    return true;
  }

  return false;
}

function ensurePlugin(config: any): { changed: boolean; config: any } {
  const current = (config && (config as any).plugin) ?? undefined;

  if (Array.isArray(current)) {
    if (current.some((entry) => matchesPluginName(entry))) {
      return { changed: false, config };
    }
    return {
      changed: true,
      config: { ...config, plugin: [...current, PLUGIN_NAME] },
    };
  }

  if (typeof current === "string") {
    if (matchesPluginName(current)) {
      return { changed: false, config };
    }
    return {
      changed: true,
      config: { ...config, plugin: [current, PLUGIN_NAME] },
    };
  }

  const nextConfig = { ...config, plugin: [PLUGIN_NAME] };
  return { changed: true, config: nextConfig };
}

function ensurePackagedSkillsPath(config: any): {
  changed: boolean;
  config: any;
} {
  const packagedSkillsPath = getPackagedSkillsPath();
  const existingSkills =
    config && typeof config.skills === "object" && config.skills !== null
      ? config.skills
      : {};
  const existingPaths = Array.isArray(existingSkills.paths)
    ? existingSkills.paths.filter((value: unknown) => {
        return typeof value === "string" && value.trim().length > 0;
      })
    : [];

  const hasPackagedSkillsPath = existingPaths.some((entry: string) => {
    return path.resolve(entry) === path.resolve(packagedSkillsPath);
  });

  if (hasPackagedSkillsPath) {
    return { changed: false, config };
  }

  return {
    changed: true,
    config: {
      ...config,
      skills: {
        ...existingSkills,
        paths: [...existingPaths, packagedSkillsPath],
      },
    },
  };
}

function ensureDefaultPermission(
  config: any,
  isNewFile: boolean,
): {
  changed: boolean;
  config: any;
} {
  // 既存の opencode.json を尊重し、permission は新規ファイル作成時のみ付与する
  if (!isNewFile) {
    return { changed: false, config };
  }

  const existing = config && (config as any).permission;

  const existingPermission =
    existing && typeof existing === "object" && existing !== null
      ? existing
      : {};

  const mergedPermission = {
    ...existingPermission,
    bash: {
      ...((existingPermission as any).bash || {}),
      "*": "ask",
    },
  };

  const nextConfig = {
    ...config,
    permission: mergedPermission,
  };

  return { changed: true, config: nextConfig };
}

function buildNewConfig(): any {
  return {
    $schema: "https://opencode.ai/config.json",
    plugin: [PLUGIN_NAME],
    skills: {
      paths: [getPackagedSkillsPath()],
    },
  };
}

export async function runInstall(opts: InstallOptions): Promise<void> {
  const filePath =
    opts.scope === "local" ? getLocalConfigPath() : getGlobalConfigPath();

  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    console.error(
      t("cli.install.error.config_dir", {
        dir,
      }),
    );
    throw err;
  }

  const existingConfig = readConfigFile(filePath);
  let config = existingConfig;
  const isNewFile = !existingConfig;

  if (!config) {
    config = buildNewConfig();
  }

  let changed = false;

  const pluginResult = ensurePlugin(config);
  config = pluginResult.config;
  changed = changed || pluginResult.changed;

  const skillsResult = ensurePackagedSkillsPath(config);
  config = skillsResult.config;
  changed = changed || skillsResult.changed;

  const permissionResult = ensureDefaultPermission(config, isNewFile);
  config = permissionResult.config;
  changed = changed || permissionResult.changed;

  if (!changed) {
    console.error(
      t("cli.install.info.already_enabled", {
        plugin: PLUGIN_NAME,
        path: filePath,
      }),
    );
    return;
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  if (isNewFile) {
    console.error(
      t("cli.install.info.created", {
        path: filePath,
      }),
    );
  } else {
    console.error(
      t("cli.install.info.updated", {
        path: filePath,
      }),
    );
  }
}
