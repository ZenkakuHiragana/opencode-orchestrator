import { tool } from "@opencode-ai/plugin/tool";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getOrchestratorBaseDir } from "./orchestrator-paths.js";

const z = tool.schema;

// Deny list for paths that must not be committed accidentally.
// - 機密情報: .env 系, credentials, secret を含む名前, キー/証明書ファイル, .ssh/.gnupg/.aws/.kube 等の機密ディレクトリ
// - よくあるビルド成果物や一時ファイル: node_modules, dist, target, build, *.log など
const DENY_PATTERNS: RegExp[] = [
  // Secrets / credentials
  /(^|\/)\.env(\.local|\.development|\.production|\.test)?$/i,
  /(^|\/)\.env\.[^/]+$/i,
  /(^|\/)\.?secrets?\b/i,
  /(^|\/)credentials?\.(json|ya?ml|txt)$/i,
  /(^|\/)id_[er]d?sa(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(password|passwd|api[_-]?key|token)/i,

  // Sensitive directories (.ssh, .gnupg, .aws, .kube, etc.)
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.kube(\/|$)/i,

  // Sensitive config files
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,

  // Common build artifacts / caches
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)target(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.nuxt(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.parcel-cache(\/|$)/,
  /(^|\/)\.pytest_cache(\/|$)/,

  // .NET / C# / MSBuild artifacts
  /(^|\/)bin(\/|$)/,
  /(^|\/)obj(\/|$)/,
  /\.csproj\.user$/i,
  /\.vbproj\.user$/i,
  /\.suo$/i,
  /\.user$/i,
  /\.userosscache$/i,
  /\.sln\.docstates$/i,

  // Visual Studio / IDE caches
  /(^|\/)\.vs(\/|$)/,
  /(^|\/)\.idea(\/|$)/,
  /(^|\/)\.vscode\/(settings|launch|tasks)\.json$/,

  // CMake / C++ build directories
  /(^|\/)CMakeFiles(\/|$)/,
  /CMakeCache\.txt$/,
  /cmake-build-(debug|release|relwithdebinfo|minsizerel)(\/|$)/i,

  // Logs / temp files
  /\.log$/i,
  /\.tmp$/i,
  /\.swp$/i,
  /\.swo$/i,
  /~$/,
];

function normalizeDenyPath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isDeniedPath(p: string): boolean {
  const normalized = normalizeDenyPath(p);
  return DENY_PATTERNS.some((re) => re.test(normalized));
}

export function parseNameOnlyList(text: string): string[] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runGit(args: string[]): Promise<GitResult> {
  return new Promise<GitResult>((resolve) => {
    const child = spawn("git", args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }

    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }

    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: String(err) });
    });

    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

// Global autocommit logger: writes JSONL entries under the orchestrator base
// logs directory (task-agnostic). This helps debug which paths and git status
// outputs the tool saw when deciding whether to commit.
let autoCommitLogPath: string | null = null;

function getAutocommitLogPath(): string | null {
  if (autoCommitLogPath !== null) return autoCommitLogPath;
  try {
    const baseDir = getOrchestratorBaseDir();
    const logsDir = path.join(baseDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
    autoCommitLogPath = path.join(logsDir, "autocommit.log");
  } catch {
    autoCommitLogPath = null;
  }
  return autoCommitLogPath;
}

function logAutocommit(entry: Record<string, unknown>): void {
  const logPath = getAutocommitLogPath();
  if (!logPath) return;
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(logPath, line + "\n", "utf8");
  } catch {
    // Logging failures must never break commit behavior.
  }
}

const autocommitTool = tool({
  description:
    "Create a git commit for specified files using conventional commits (with safety blacklist). " +
    "IMPORTANT: Do NOT use this tool unless the system prompt or agent description explicitly " +
    "instructs you to use it. Some users do not want agents to interact with git. " +
    "If the instructions do not mention autocommit, use `bash` with `git` commands instead " +
    "or ask the user before committing.",
  args: {
    type: z
      .enum([
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "perf",
        "build",
        "ci",
        "style",
        "revert",
      ])
      .describe("Conventional commit type (e.g. feat, fix, chore)"),
    message: z
      .string()
      .min(1)
      .describe("Conventional commit message (subject line, without type)"),
    details: z
      .string()
      .optional()
      .describe(
        "Optional extended commit details (body) that will be added as an additional -m block.",
      ),
    files: z
      .array(z.string())
      .nonempty()
      .describe("Paths to include in the commit (relative to repo root)"),
  },
  async execute(
    args: { type: string; message: string; files: string[]; details?: string },
    _context: unknown,
  ) {
    const { type, message, files, details } = args;
    logAutocommit({
      event: "execute_start",
      cwd: process.cwd(),
      type,
      message,
      files,
    });
    // 1) 変更ファイル一覧を git diff + git ls-files ベースで収集
    //    - diff --name-only / diff --cached --name-only で追跡ファイルの変更
    //    - ls-files --others --exclude-standard で untracked ファイル
    const changed = new Set<string>();

    const unstaged = await runGit(["diff", "--name-only"]);
    if (unstaged.exitCode !== 0) {
      logAutocommit({
        event: "git_diff_error",
        kind: "unstaged",
        args: ["diff", "--name-only"],
        exitCode: unstaged.exitCode,
        stdout: unstaged.stdout,
        stderr: unstaged.stderr,
      });
      return JSON.stringify({
        ok: false,
        error: "git diff --name-only failed",
        out: unstaged.stdout + unstaged.stderr,
      });
    }
    const unstagedList = parseNameOnlyList(unstaged.stdout);
    for (const p of unstagedList) {
      if (p) changed.add(p);
    }

    const stagedAll = await runGit(["diff", "--cached", "--name-only"]);
    if (stagedAll.exitCode !== 0) {
      logAutocommit({
        event: "git_diff_error",
        kind: "staged_all",
        args: ["diff", "--cached", "--name-only"],
        exitCode: stagedAll.exitCode,
        stdout: stagedAll.stdout,
        stderr: stagedAll.stderr,
      });
      return JSON.stringify({
        ok: false,
        error: "git diff --cached --name-only failed",
        out: stagedAll.stdout + stagedAll.stderr,
      });
    }
    const stagedAllList = parseNameOnlyList(stagedAll.stdout);
    for (const p of stagedAllList) {
      if (p) changed.add(p);
    }

    const untracked = await runGit([
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    if (untracked.exitCode !== 0) {
      logAutocommit({
        event: "git_ls_files_error",
        args: ["ls-files", "--others", "--exclude-standard"],
        exitCode: untracked.exitCode,
        stdout: untracked.stdout,
        stderr: untracked.stderr,
      });
      return JSON.stringify({
        ok: false,
        error: "git ls-files --others --exclude-standard failed",
        out: untracked.stdout + untracked.stderr,
      });
    }
    const untrackedList = parseNameOnlyList(untracked.stdout);
    for (const p of untrackedList) {
      if (p) changed.add(p);
    }

    logAutocommit({
      event: "changed_files_detected",
      diff_unstaged: unstagedList,
      diff_staged: stagedAllList,
      untracked: untrackedList,
      changed: Array.from(changed),
    });

    if (changed.size === 0) {
      logAutocommit({ event: "no_changed_files" });
      return JSON.stringify({ ok: false, reason: "no changes" });
    }
    const uniqueFiles = Array.from(
      new Set(files.map((f) => f.trim()).filter(Boolean)),
    );

    // 2) 変更があるファイルのうち、指定されたものだけを対象にする
    const requestedChanged = uniqueFiles.filter((f) => changed.has(f));
    if (requestedChanged.length === 0) {
      logAutocommit({
        event: "no_changes_for_requested_files",
        requested: uniqueFiles,
        changed: Array.from(changed),
      });
      return JSON.stringify({
        ok: false,
        reason: "no changes for requested files",
        requested: uniqueFiles,
      });
    }

    // 3) ブラックリストでフィルタリング
    const denied = requestedChanged.filter((p) => isDeniedPath(p));
    const allowed = requestedChanged.filter((p) => !isDeniedPath(p));

    if (allowed.length === 0) {
      return JSON.stringify({
        ok: false,
        reason: "all requested files are denied by blacklist",
        denied,
      });
    }

    // 4) 既にステージング済みのファイルがある場合は、予期せぬコミットを避けるためにチェック
    const stagedList = await runGit(["diff", "--cached", "--name-only"]);
    if (stagedList.exitCode !== 0) {
      return JSON.stringify({
        ok: false,
        error: "git diff --cached --name-only failed",
        out: stagedList.stdout + stagedList.stderr,
      });
    }
    const alreadyStaged = parseNameOnlyList(stagedList.stdout);
    const extraStaged = alreadyStaged.filter((p) => !allowed.includes(p));
    if (extraStaged.length > 0) {
      logAutocommit({
        event: "extra_staged_files",
        extraStaged,
        allowed,
      });
      return JSON.stringify({
        ok: false,
        error: "index has staged files outside requested set",
        stagedOutsideRequest: extraStaged,
      });
    }

    // 5) allowed に含まれるファイルのうち、まだステージされていないものだけをステージング
    const toStage = allowed.filter((p) => !alreadyStaged.includes(p));
    for (const path of toStage) {
      const addRes = await runGit(["add", "--", path]);
      if (addRes.exitCode !== 0) {
        logAutocommit({
          event: "git_add_failed",
          file: path,
          exitCode: addRes.exitCode,
          stdout: addRes.stdout,
          stderr: addRes.stderr,
        });
        return JSON.stringify({
          ok: false,
          error: "git add failed",
          file: path,
          out: addRes.stdout + addRes.stderr,
        });
      }
    }

    // 6) ステージングされたファイルを確認
    const stagedList2 = await runGit(["diff", "--cached", "--name-only"]);
    if (stagedList2.exitCode !== 0) {
      return JSON.stringify({
        ok: false,
        error: "git diff --cached --name-only failed",
        out: stagedList2.stdout + stagedList2.stderr,
      });
    }
    const stagedForCommit = parseNameOnlyList(stagedList2.stdout).filter((p) =>
      allowed.includes(p),
    );
    if (stagedForCommit.length === 0) {
      logAutocommit({
        event: "no_eligible_changes_after_filters",
        allowed,
        denied,
        staged: parseNameOnlyList(stagedList2.stdout),
      });
      return JSON.stringify({
        ok: false,
        reason: "no eligible changes after filters",
        denied,
      });
    }

    // 7) conventional commit メッセージを構築
    const trimmedMsg = message.trim();
    const fullMessage = `${type}: ${trimmedMsg}`;

    // 8) コミットを実行
    const trimmedDetails = (details ?? "").trim();
    const commitArgs = trimmedDetails
      ? ["commit", "-m", fullMessage, "-m", trimmedDetails]
      : ["commit", "-m", fullMessage];
    const commit = await runGit(commitArgs);
    if (commit.exitCode !== 0) {
      logAutocommit({
        event: "git_commit_failed",
        args: commitArgs,
        exitCode: commit.exitCode,
        stdout: commit.stdout,
        stderr: commit.stderr,
      });
      return JSON.stringify({
        ok: false,
        error: "git commit failed",
        out: commit.stdout + commit.stderr,
      });
    }

    const rev = await runGit(["rev-parse", "HEAD"]);
    if (rev.exitCode !== 0) {
      logAutocommit({
        event: "git_rev_parse_failed",
        exitCode: rev.exitCode,
        stdout: rev.stdout,
        stderr: rev.stderr,
      });
      return JSON.stringify({
        ok: false,
        error: "git rev-parse HEAD failed",
        out: rev.stdout + rev.stderr,
      });
    }
    const head = rev.stdout.trim();

    logAutocommit({
      event: "commit_success",
      head,
      message: fullMessage,
      details: trimmedDetails || undefined,
      files: stagedForCommit,
    });

    return JSON.stringify({
      ok: true,
      head,
      message: fullMessage,
      details: trimmedDetails || undefined,
      files: stagedForCommit,
      denied,
    });
  },
});

export default autocommitTool;
