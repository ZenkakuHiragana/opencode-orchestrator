export type CommandUsage = "must_exec" | "may_exec" | "doc_only";

export type CommandDescriptor = {
  id: string;
  command: string;
  role: string;
  usage: CommandUsage;
};

export type PreflightProbeResult = {
  id: string;
  command: string;
  role: string | null;
  usage: CommandUsage;
  available: boolean;
  exit_code: number | null;
  stderr_excerpt: string;
};
