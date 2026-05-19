import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  getOrchestratorLogsDir,
  getOrchestratorStateDir,
} from "./orchestrator-paths.js";
import {
  hasOpenNonAutoResolvableProposals,
  loadProposals,
} from "./orchestrator-proposals.js";
import type { LoopOptions } from "./cli-args.js";
import { runOpencode } from "./orchestrator-process.js";
import { buildCommitPrompt, withTaskKeyHint } from "./orchestrator-prompts.js";
import {
  loadStatusJson,
  OrchestratorStatus,
  saveStatusJson,
} from "./orchestrator-status.js";
import {
  ExecutorAuditorStepResult,
  maybeRunTodoWriterStep,
  TodoWriterStepResult,
  runExecutorAndAuditorStep,
} from "./orchestrator-steps.js";
import { enforceCommandPolicyGate } from "./orchestrator-loop-gate.js";
export { enforceCommandPolicyGate } from "./orchestrator-loop-gate.js";
import { buildFileArgs, createInitialSession } from "./orchestrator-session.js";

// Re-export for CLI consumers (cli.ts) that historically imported
// buildFileArgs from orchestrator-loop.
export { buildFileArgs };

export async function runLoop(opts: LoopOptions): Promise<boolean> {
  const logDir = getOrchestratorLogsDir(opts.task);
  const stateDir = getOrchestratorStateDir(opts.task);
  const statusPath = path.join(stateDir, "status.json");
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  let status: OrchestratorStatus = loadStatusJson(statusPath);

  const isWindows = process.platform === "win32";

  // 危険系フラグの相互排他チェック
  if (opts.dangerouslySkipCommandPolicy && opts.bwrapSkipCommandPolicy) {
    throw new Error(
      "--dangerously-skip-command-policy と --bwrap-skip-command-policy は同時には指定できません",
    );
  }

  if (opts.bwrapSkipCommandPolicy) {
    if (isWindows) {
      console.error(
        "[opencode-orchestrator] WARN: --bwrap-skip-command-policy は Windows 環境ではサポートされていないため無視されます。通常の command-policy 準拠モードで実行します。",
      );
      enforceCommandPolicyGate(stateDir);
    } else {
      // bwrap が利用可能か事前にチェックする
      const bwrapCheck = spawnSync("bwrap", ["--version"], {
        stdio: "ignore",
      });
      if (bwrapCheck.status !== 0) {
        throw new Error(
          "--bwrap-skip-command-policy が指定されましたが、'bwrap' コマンドが見つからないか実行できません。" +
            " 先に bubblewrap パッケージをインストールするか、このフラグを外して実行してください。",
        );
      }

      console.error(
        "[opencode-orchestrator] WARN: --bwrap-skip-command-policy が指定されたため command-policy.json ゲートをスキップし、Executor ステップを Bubblewrap サンドボックス内で実行します。",
      );
      // bwrap モードでは command-policy.json 自体はロードせず、Executor 用
      // 子プロセスの起動時にのみサンドボックス用の環境変数を付与して制御する。

      // CLI 起動時に bwrap 引数の構文チェックと簡易な実行チェックを行う。
      // ここで失敗した場合はループ全体を中断する。
      const repoDir = process.cwd();
      const stateDir = getOrchestratorStateDir(opts.task);
      let effectiveArgs: string[];

      if (opts.bwrapArgs.length > 0) {
        effectiveArgs = opts.bwrapArgs.slice();
      } else {
        const defaultArgs: string[] = [];

        const maybeRoBind = (p: string) => {
          try {
            if (fs.existsSync(p)) {
              defaultArgs.push("--ro-bind", p, p);
            }
          } catch {
            // ignore
          }
        };

        const maybeBind = (p: string) => {
          try {
            if (fs.existsSync(p)) {
              defaultArgs.push("--bind", p, p);
            }
          } catch {
            // ignore
          }
        };

        maybeRoBind("/usr");
        maybeRoBind("/bin");
        maybeRoBind("/sbin");
        maybeRoBind("/lib");
        maybeRoBind("/lib64");
        // DNS 解決や各種設定ファイルへの依存を考慮して /etc も公開する。
        maybeRoBind("/etc");

        // OpenCode / orchestrator の設定・状態・バイナリが参照する典型的な
        // ユーザーローカルディレクトリをサンドボックスからも見えるようにする。
        const homeDir = process.env.HOME;
        if (homeDir && homeDir.length > 0) {
          const xdgConfigHome =
            process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
          const xdgShareHome =
            process.env.XDG_SHARE_HOME || path.join(homeDir, ".local", "share");
          const xdgStateHome =
            process.env.XDG_STATE_HOME || path.join(homeDir, ".local", "state");
          const xdgCacheHome =
            process.env.XDG_CACHE_HOME || path.join(homeDir, ".cache");
          const npmrcPath = path.join(homeDir, ".npmrc");
          const opencodeCacheDir = path.join(xdgCacheHome, "opencode");
          const opencodeConfigDir = path.join(xdgConfigHome, "opencode");
          const opencodeShareDir = path.join(xdgShareHome, "opencode");
          const opencodeStateDir = path.join(xdgStateHome, "opencode");
          const opencodeHomeDir = path.join(homeDir, ".opencode");

          // 設定ディレクトリは読み取り専用で十分。
          maybeRoBind(opencodeConfigDir);
          // npm のグローバル設定 (~/.npmrc) も read-only で見せておく。プラグイン
          // の取得や私設レジストリ利用などで参照される可能性がある。
          maybeRoBind(npmrcPath);

          // 状態ディレクトリや .opencode は書き込みが発生する可能性が高いので
          // 読み書きバインドにする。
          maybeBind(opencodeCacheDir);
          maybeBind(opencodeShareDir);
          maybeBind(opencodeStateDir);
          maybeBind(opencodeHomeDir);
        }

        defaultArgs.push("--dev", "/dev");
        defaultArgs.push("--proc", "/proc");
        // /tmp は各 Executor サンドボックス専用の tmpfs にする。
        defaultArgs.push("--tmpfs", "/tmp");
        defaultArgs.push("--bind", repoDir, repoDir);
        defaultArgs.push("--bind", stateDir, stateDir);
        defaultArgs.push("--chdir", repoDir);
        defaultArgs.push("--unshare-pid");
        // ネットワークはデフォルトでは隔離しない。models.dev などの
        // LLM エンドポイントへのアクセスが必要なケースが多いため、
        // 完全なネットワーク分離を行いたい場合は --bwrap-arg で
        // 明示的に --unshare-net を指定してもらう。親プロセス終了時には
        // サンドボックスも確実に終了させたいので --die-with-parent を付与する。
        defaultArgs.push("--die-with-parent");
        defaultArgs.push("--new-session");

        effectiveArgs = defaultArgs;
      }

      const dryRun = spawnSync("bwrap", [...effectiveArgs, "--", "true"], {
        stdio: "ignore",
      });
      if (dryRun.status !== 0) {
        throw new Error(
          "--bwrap-skip-command-policy が指定されましたが、指定された bwrap 引数でのサンドボックス初期化に失敗しました。" +
            " 引数を見直すか、このフラグを外して実行してください。",
        );
      }

      // 後続のステップで再利用できるよう、検証済みの引数を上書きしておく。
      opts.bwrapArgs = effectiveArgs;
    }
  } else if (opts.dangerouslySkipCommandPolicy) {
    console.error(
      "[opencode-orchestrator] WARN: --dangerously-skip-command-policy が指定されたため command-policy.json ゲートをサンドボックス無しでスキップします。このモードでは Executor が計画フェーズで設定したコマンド許可リストを無視するようになり、OpenCode のコマンド権限設定のみ適用されます。",
    );
  } else {
    enforceCommandPolicyGate(stateDir);
  }

  const acceptanceIndexPath = path.join(stateDir, "acceptance-index.json");
  const proposalsPath = path.join(stateDir, "proposals.json");
  const fileArgs = buildFileArgs(opts, stateDir);

  let sessionId = opts.sessionId;
  const proposalsFile = loadProposals(proposalsPath);

  if (!sessionId && hasOpenNonAutoResolvableProposals(proposalsFile)) {
    console.error(
      "[opencode-orchestrator] proposals.json に未解決の非自動解決 proposal が残っているため、新しいセッションを開始できません。",
    );
    console.error("[opencode-orchestrator] 以前の実行で記録された proposal:");
    for (const p of proposalsFile.proposals.filter(
      (proposal) => proposal.status === "open",
    )) {
      console.error(
        `  - [${p.source}] kind=${p.kind} cycle=${p.cycle} id=${p.id}`,
      );
      console.error(`    summary: ${p.summary}`);
      if (p.details) {
        const firstLine = String(p.details).split(/\r?\n/, 1)[0];
        console.error(`    details: ${firstLine}`);
      }
    }
    console.error(
      "[opencode-orchestrator] これらの内容を orch-planner で処理し、proposal を解消してから loop を再実行してください。",
    );
    return false;
  }

  if (!sessionId) {
    if (opts.continueLast) {
      if (!status.last_session_id) {
        throw new Error(
          "--continue が指定されていますが、status.json に last_session_id が記録されていません (このタスクの過去セッションが見つかりません)",
        );
      }
      sessionId = status.last_session_id;
      console.error(
        `[opencode-orchestrator] status.json.last_session_id=${sessionId} から既存セッションを継続します。`,
      );
    } else {
      sessionId = await createInitialSession(opts, logDir, fileArgs);
    }
  } else {
    console.error(
      `[opencode-orchestrator] 明示的に指定されたセッション ID を使用します: ${sessionId}`,
    );
  }

  console.error(`[opencode-orchestrator] セッション ID: ${sessionId}`);
  console.error(
    "[opencode-orchestrator] loop モード: Executor と Auditor をステップごとに順番に実行します。",
  );

  status.last_session_id = sessionId!;
  status.consecutive_env_blocked = 0;
  if (status.failure_budget) {
    status.failure_budget.consecutive_env_blocked = 0;
  }
  saveStatusJson(statusPath, status);

  let done = false;
  let restartCount = 0;
  let forceTodoWriterNextStep = false;

  for (let step = 1; step <= opts.maxLoop; step += 1) {
    console.error(
      `\n[opencode-orchestrator] ======== STEP ${step} / ${opts.maxLoop} ========`,
    );

    const stepId = String(step).padStart(3, "0");
    const orchLog = path.join(logDir, `orch_step_${stepId}.txt`);
    const auditRaw = path.join(logDir, `audit_step_${stepId}.jsonl`);

    status.current_cycle = step;

    let todoWriterResult: TodoWriterStepResult | null = null;

    const needReplan =
      forceTodoWriterNextStep ||
      loadProposals(proposalsPath).proposals.some(
        (proposal) => proposal.status === "open" && proposal.auto_resolvable,
      );
    if (fs.existsSync(acceptanceIndexPath) && (step === 1 || needReplan)) {
      todoWriterResult = await maybeRunTodoWriterStep(
        opts,
        step,
        stepId,
        stateDir,
        logDir,
        acceptanceIndexPath,
        sessionId!,
        fileArgs,
        status,
        statusPath,
        restartCount,
        forceTodoWriterNextStep,
      );

      sessionId = todoWriterResult.sessionId;
      restartCount = todoWriterResult.restartCount;
      forceTodoWriterNextStep = todoWriterResult.forceTodoWriterNextStep;

      if (todoWriterResult.abortLoop) {
        break;
      }

      if (todoWriterResult.restartedSession) {
        continue;
      }
    }

    if (todoWriterResult && todoWriterResult.skipExecutorThisStep) {
      // Skip executor/auditor for this step when todo-writer produced an
      // unusable or coverage-breaking todo.json. The failure details are
      // already recorded in status.json and logs; the next loop iteration
      // will either re-enter todo-writer or stop based on those signals.
      continue;
    }

    const execAuditResult: ExecutorAuditorStepResult =
      await runExecutorAndAuditorStep(
        opts,
        step,
        sessionId!,
        fileArgs,
        orchLog,
        auditRaw,
        status,
        statusPath,
        restartCount,
        forceTodoWriterNextStep,
        logDir,
      );

    sessionId = execAuditResult.sessionId;
    restartCount = execAuditResult.restartCount;
    forceTodoWriterNextStep = execAuditResult.forceTodoWriterNextStep;
    done = execAuditResult.done;

    const traceability =
      status.last_executor_step?.requirement_traceability ?? [];
    if (traceability.length > 0) {
      for (const item of traceability) {
        console.error(
          `[opencode-orchestrator] requirement diff trace: ${item.requirement_id} -> ${item.representative_files.join(", ")}`,
        );
      }
    }

    if (execAuditResult.abortLoop) {
      break;
    }

    if (execAuditResult.skipAuditorThisStep) {
      continue;
    }

    if (done) {
      break;
    }
  }

  if (!done) {
    console.error(
      `[opencode-orchestrator] max-loop=${opts.maxLoop} まで到達しましたが、タスクは完了しませんでした。`,
    );
  }

  const exportPath = path.join(
    logDir,
    `orchestrator_session_${Date.now().toString()}.json`,
  );
  console.error(
    `[opencode-orchestrator] orchestrator セッションをエクスポートします: ${exportPath}`,
  );
  const exportRes = await runOpencode(["export", sessionId!], undefined, false);
  if (exportRes.code === 0 && exportRes.stdout) {
    try {
      fs.writeFileSync(exportPath, exportRes.stdout, { encoding: "utf8" });
    } catch (err) {
      console.error(
        `[opencode-orchestrator] WARN: エクスポートファイル ${exportPath} の書き込みに失敗しました: ${String(
          err,
        )}`,
      );
    }
  } else if (exportRes.code !== 0) {
    console.error(
      "[opencode-orchestrator] WARN: opencode export が非 0 ステータスで終了しました。",
    );
  }

  if (done && opts.commitOnDone) {
    console.error(
      "[opencode-orchestrator] COMMIT_ON_DONE が有効です。Executor にコミット作成を依頼します。",
    );
    const commitPromptBase = buildCommitPrompt();
    const commitPrompt = withTaskKeyHint(commitPromptBase, opts.task);
    const gitCheck = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
    });
    if (gitCheck.status === 0) {
      await runOpencode([
        "run",
        "--session",
        sessionId!,
        ...fileArgs,
        "--",
        commitPrompt,
      ]);
    } else {
      console.error(
        "[opencode-orchestrator] COMMIT_ON_DONE は有効ですが、カレントディレクトリが git リポジトリではないためコミット処理をスキップします。",
      );
    }
  }

  return done;
}
