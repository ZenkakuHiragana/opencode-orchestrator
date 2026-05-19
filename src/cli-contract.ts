export type CliSubcommand =
  | "run"
  | "resume"
  | "status"
  | "doctor"
  | "fix"
  | "completion"
  | "loop"
  | "list"
  | "exec"
  | "clear";

export type CliOptionSpec = {
  value: string;
  takesValue: boolean;
};

export const CLI_SUBCOMMANDS: readonly CliSubcommand[] = [
  "run",
  "resume",
  "status",
  "doctor",
  "fix",
  "completion",
  "loop",
  "list",
  "exec",
  "clear",
];

export const TASK_AWARE_SUBCOMMANDS: readonly CliSubcommand[] = [
  "loop",
  "run",
  "resume",
  "status",
  "fix",
  "list",
  "clear",
];

export const SUPPORTED_COMPLETION_SHELLS = ["bash", "powershell"] as const;

export const SUBCOMMAND_OPTION_SPECS: Record<
  CliSubcommand,
  readonly CliOptionSpec[]
> = {
  run: [
    { value: "--task", takesValue: true },
    { value: "-t", takesValue: true },
    { value: "--commit", takesValue: false },
    { value: "--max-loop", takesValue: true },
    { value: "--max-restarts", takesValue: true },
    { value: "--dangerously-skip-command-policy", takesValue: false },
    { value: "--bwrap-skip-command-policy", takesValue: false },
    { value: "--bwrap-arg", takesValue: true },
    { value: "--file", takesValue: true },
    { value: "-f", takesValue: true },
  ],
  resume: [
    { value: "--task", takesValue: true },
    { value: "-t", takesValue: true },
    { value: "--commit", takesValue: false },
    { value: "--max-loop", takesValue: true },
    { value: "--max-restarts", takesValue: true },
    { value: "--dangerously-skip-command-policy", takesValue: false },
    { value: "--bwrap-skip-command-policy", takesValue: false },
    { value: "--bwrap-arg", takesValue: true },
    { value: "--file", takesValue: true },
    { value: "-f", takesValue: true },
  ],
  status: [
    { value: "--task", takesValue: true },
    { value: "-t", takesValue: true },
  ],
  doctor: [],
  fix: [
    { value: "--task", takesValue: true },
    { value: "-t", takesValue: true },
  ],
  completion: [],
  loop: [
    { value: "--task", takesValue: true },
    { value: "-t", takesValue: true },
    { value: "--session", takesValue: true },
    { value: "--continue", takesValue: false },
    { value: "--commit", takesValue: false },
    { value: "--max-loop", takesValue: true },
    { value: "--max-restarts", takesValue: true },
    { value: "--dangerously-skip-command-policy", takesValue: false },
    { value: "--bwrap-skip-command-policy", takesValue: false },
    { value: "--bwrap-arg", takesValue: true },
    { value: "--file", takesValue: true },
    { value: "-f", takesValue: true },
  ],
  list: [
    { value: "--json", takesValue: false },
    { value: "--task", takesValue: true },
    { value: "-t", takesValue: true },
    { value: "--proposals", takesValue: false },
    { value: "--open", takesValue: false },
  ],
  exec: [
    { value: "--allow-fs-read", takesValue: true },
    { value: "--allow-fs-write", takesValue: true },
    { value: "--timeout", takesValue: true },
    { value: "--max-output", takesValue: true },
    { value: "--file", takesValue: true },
    { value: "--arg", takesValue: true },
  ],
  clear: [
    { value: "--task", takesValue: true },
    { value: "-t", takesValue: true },
    { value: "--proposals", takesValue: false },
    { value: "--resolve", takesValue: true },
    { value: "--dismiss", takesValue: true },
    { value: "-y", takesValue: false },
  ],
};

export function getCliOptionSpecs(
  subcommand: CliSubcommand,
): readonly CliOptionSpec[] {
  return SUBCOMMAND_OPTION_SPECS[subcommand];
}

export function getCliOptionValues(subcommand: CliSubcommand): string[] {
  return SUBCOMMAND_OPTION_SPECS[subcommand].map((spec) => spec.value);
}
