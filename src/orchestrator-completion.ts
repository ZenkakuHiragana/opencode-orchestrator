import {
  CLI_SUBCOMMANDS,
  getCliOptionValues,
  SUPPORTED_COMPLETION_SHELLS,
  type CliSubcommand,
} from "./cli-contract.js";
import { listKnownTasks, type TaskInfo } from "./task-resolution.js";
import { parseCompletionCliArgs } from "./cli-args.js";
import { t } from "./i18n/messages.js";

export interface CompletionCommandOptions {
  argv: string[];
}

export interface CompleteCommandOptions {
  argv: string[];
}

export type CompletionCandidateType = "subcommand" | "option" | "task";

export interface CompletionCandidate {
  type: CompletionCandidateType;
  value: string;
  description: string;
}

function describeOption(value: string): string {
  if (value === "--task" || value === "-t") {
    return t("cli.completion.option.task");
  }
  return t("cli.completion.option.generic");
}

function getSubcommandCandidates(): CompletionCandidate[] {
  return CLI_SUBCOMMANDS.map((value) => ({
    type: "subcommand" as const,
    value,
    description: t(`cli.completion.subcommand.${value}` as never),
  }));
}

function getOptionCandidates(
  subcommand?: CliSubcommand,
): CompletionCandidate[] {
  const values = subcommand
    ? getCliOptionValues(subcommand)
    : [...new Set(CLI_SUBCOMMANDS.flatMap((name) => getCliOptionValues(name)))];
  return values.map((value) => ({
    type: "option",
    value,
    description: describeOption(value),
  }));
}

function getTaskCandidates(): CompletionCandidate[] {
  const infos: TaskInfo[] = listKnownTasks();
  return infos.map((info: TaskInfo) => ({
    type: "task",
    value: info.task,
    description: t("cli.completion.task.known"),
  }));
}

function getCompletionShellCandidates(): CompletionCandidate[] {
  return [...SUPPORTED_COMPLETION_SHELLS].map((value) => ({
    type: "option" as const,
    value,
    description: t("cli.completion.option.shell"),
  }));
}

export async function runCompletionCommand(
  opts: CompletionCommandOptions,
): Promise<number> {
  let shell: "bash" | "powershell";
  try {
    shell = parseCompletionCliArgs(opts.argv).shell;
  } catch (error) {
    console.error(String((error as Error).message ?? error));
    return 1;
  }

  if (shell === "bash") {
    const header = t("cli.completion.script_header.bash");
    const script = `${header}
_ococ_completion() {
  local line point results
  line="$COMP_LINE"
  point="$COMP_POINT"

  results=$(ococ __complete bash "$line" "$point" 2>/dev/null) || return

  COMPREPLY=()
  while IFS= read -r cand; do
    local value
    value=$(printf '%s\n' "$cand" | sed -n 's/.*"value":"\\([^"]*\\)".*/\\1/p')
    if [[ -n "$value" ]]; then
      COMPREPLY+=("$value")
    fi
  done <<< "$results"
}

complete -F _ococ_completion ococ
complete -F _ococ_completion opencode-orchestrator
`;
    console.log(script);
    return 0;
  }

  if (shell === "powershell") {
    const header = t("cli.completion.script_header.powershell");
    const script = `${header}
Register-ArgumentCompleter -Native -CommandName 'ococ','opencode-orchestrator' -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $line = $commandAst.ToString()
  $point = $cursorPosition

  $results = & ococ __complete powershell $line $point 2>$null

  foreach ($json in $results) {
    if (-not $json) { continue }
    try {
      $candidate = $json | ConvertFrom-Json
    } catch {
      continue
    }
    if (-not $candidate.value) { continue }
    [System.Management.Automation.CompletionResult]::new(
      $candidate.value,
      $candidate.value,
      'ParameterValue',
      $candidate.description
    )
  }
}
`;
    console.log(script);
    return 0;
  }

  return 1;
}

export async function runCompleteCommand(
  opts: CompleteCommandOptions,
): Promise<number> {
  const subcommandCandidates = getSubcommandCandidates();
  const optionCandidates = getOptionCandidates();
  const taskCandidates = getTaskCandidates();
  const candidates: CompletionCandidate[] = [
    ...subcommandCandidates,
    ...optionCandidates,
    ...taskCandidates,
  ];

  // 後方互換性: 文脈情報 (shell/line/cursor) が渡されていない場合は、
  // 既存どおりすべての候補をそのまま返す。
  if (opts.argv.length < 3) {
    for (const candidate of candidates) {
      console.log(JSON.stringify(candidate));
    }
    return 0;
  }

  const [shell, line, cursorRaw] = opts.argv;
  void shell; // いまのところシェル種別では分岐しない

  const cursor = Number.parseInt(cursorRaw, 10);
  const safeCursor = Number.isFinite(cursor)
    ? Math.min(Math.max(cursor, 0), line.length)
    : line.length;

  const before = line.slice(0, safeCursor);
  const parts = before.split(/\s+/).filter((p) => p.length > 0);

  if (parts.length === 0) {
    for (const candidate of candidates) {
      console.log(JSON.stringify(candidate));
    }
    return 0;
  }

  const commandName = parts[0];
  if (commandName !== "ococ" && commandName !== "opencode-orchestrator") {
    for (const candidate of candidates) {
      console.log(JSON.stringify(candidate));
    }
    return 0;
  }

  const args = parts.slice(1);
  const endsWithSpace = before.endsWith(" ");

  // 引数がまだ 1 つもない場合は、サブコマンド候補のみを返す
  if (args.length === 0) {
    const filtered = candidates.filter((c) => c.type === "subcommand");
    for (const candidate of filtered) {
      console.log(JSON.stringify(candidate));
    }
    return 0;
  }

  const knownSubcommands = new Set<string>(CLI_SUBCOMMANDS);

  const subcommand = args[0] as CliSubcommand;
  const currentWord = endsWithSpace ? "" : args[args.length - 1];

  // サブコマンド入力中 (まだ確定していない) 場合はサブコマンド候補に絞る
  if (!knownSubcommands.has(subcommand)) {
    const prefix = subcommand.toLowerCase();
    const filtered = candidates.filter(
      (c) =>
        c.type === "subcommand" && c.value.toLowerCase().startsWith(prefix),
    );
    const result = filtered.length > 0 ? filtered : subcommandCandidates;
    for (const candidate of result) {
      console.log(JSON.stringify(candidate));
    }
    return 0;
  }

  const subcommandOptions = getOptionCandidates(subcommand);
  if (subcommand === "completion") {
    const shellCandidates = getCompletionShellCandidates();
    const filtered = currentWord
      ? shellCandidates.filter((candidate) =>
          candidate.value.toLowerCase().startsWith(currentWord.toLowerCase()),
        )
      : shellCandidates;
    for (const candidate of filtered) {
      console.log(JSON.stringify(candidate));
    }
    return 0;
  }

  const supportsTaskFlag = subcommandOptions.some(
    (candidate) => candidate.value === "--task" || candidate.value === "-t",
  );
  const taskFlagIndex = supportsTaskFlag
    ? Math.max(args.lastIndexOf("--task"), args.lastIndexOf("-t"))
    : -1;

  // --task の直後、またはその値を入力中の位置ではタスク候補のみを返す
  if (taskFlagIndex >= 0) {
    const currentIndex = endsWithSpace ? -1 : args.length - 1;
    const isAfterTaskFlag = taskFlagIndex === args.length - 1 && endsWithSpace;
    const isCompletingTaskValue =
      !endsWithSpace && currentIndex === taskFlagIndex + 1;

    if (isAfterTaskFlag) {
      for (const candidate of taskCandidates) {
        console.log(JSON.stringify(candidate));
      }
      return 0;
    }

    if (isCompletingTaskValue) {
      const prefix = currentWord.toLowerCase();
      const filteredTasks = taskCandidates.filter((c) =>
        c.value.toLowerCase().startsWith(prefix),
      );
      for (const candidate of filteredTasks) {
        console.log(JSON.stringify(candidate));
      }
      return 0;
    }
  }

  // 高レベルサブコマンドで --task 以外の位置の場合:
  // "-" 入力中であればオプション候補、それ以外はそのサブコマンド用オプションを提案
  if (currentWord.startsWith("-")) {
    const prefix = currentWord.toLowerCase();
    const filteredOptions = subcommandOptions.filter((c) =>
      c.value.toLowerCase().startsWith(prefix),
    );
    for (const candidate of filteredOptions) {
      console.log(JSON.stringify(candidate));
    }
    return 0;
  }

  for (const candidate of subcommandOptions) {
    console.log(JSON.stringify(candidate));
  }
  return 0;
}
