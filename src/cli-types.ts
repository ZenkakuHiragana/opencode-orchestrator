export interface LoopOptions {
  task: string;
  prompt: string;
  sessionId?: string;
  continueLast: boolean;
  commitOnDone: boolean;
  maxLoop: number;
  maxRestarts: number;
  dangerouslySkipCommandPolicy: boolean;
  bwrapSkipCommandPolicy: boolean;
  bwrapArgs: string[];
  files: string[];
}

export interface ListOptions {
  format: "text" | "json";
  task?: string;
  showProposals?: boolean;
  openOnly?: boolean;
}

export interface ExecOptions {
  allowFsRead: string[];
  allowFsWrite: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  filePath?: string;
  scriptSource: string;
  scriptArgs: string[];
}

export interface HighLevelLoopWrapperOptions {
  task?: string;
  loopArgv: string[];
}

export interface TaskLookupOptions {
  task?: string;
}

export interface DoctorOptions {
  help: boolean;
}

export interface CompletionCliOptions {
  shell: "bash" | "powershell";
}
