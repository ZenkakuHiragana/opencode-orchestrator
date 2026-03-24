import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import helperCommandsData from "../resources/helper-commands.json" with { type: "json" };

import {
  getOrchestratorLogsDir,
  getOrchestratorStateDir,
} from "./orchestrator-paths.js";
import type { LoopOptions } from "./cli-args.js";
import { runOpencode } from "./orchestrator-process.js";
import { buildCommitPrompt } from "./orchestrator-prompts.js";
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

  enforceCommandPolicyGate(stateDir);

  const acceptanceIndexPath = path.join(stateDir, "acceptance-index.json");
  const fileArgs = buildFileArgs(opts, stateDir);

  let sessionId = opts.sessionId;

  if (
    !sessionId &&
    Array.isArray(status.proposals) &&
    status.proposals.length > 0
  ) {
    console.error(
      "[opencode-orchestrator] status.json.proposals に未処理の proposal が残っているため、新しいセッションを開始できません。",
    );
    console.error("[opencode-orchestrator] 以前の実行で記録された proposal:");
    for (const p of status.proposals) {
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
  status.proposals = [];
  saveStatusJson(statusPath, status);

  let done = false;
  let restartCount = 0;
  let forceTodoWriterNextStep = false;

  for (let step = 1; step <= opts.maxLoop; step += 1) {
    console.error(
      `\n[opencode-orchestrator] === STEP ${step} / maxLoop=${opts.maxLoop} ===`,
    );
    console.error(`[opencode-orchestrator] 進捗: ${step}/${opts.maxLoop}`);

    const stepId = String(step).padStart(3, "0");
    const orchLog = path.join(logDir, `orch_step_${stepId}.txt`);
    const auditRaw = path.join(logDir, `audit_step_${stepId}.jsonl`);

    status.current_cycle = step;

    const needReplan =
      status.replan_required === true || forceTodoWriterNextStep;
    if (fs.existsSync(acceptanceIndexPath) && (step === 1 || needReplan)) {
      const todoWriterResult: TodoWriterStepResult =
        await maybeRunTodoWriterStep(
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
    const commitPrompt = buildCommitPrompt();
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

export function enforceCommandPolicyGate(stateDir: string): void {
  const policyPath = path.join(stateDir, "command-policy.json");
  const requiredHelperIds = new Set(
    helperCommandsData.helper_commands.map((helper) => helper.id),
  );
  if (!fs.existsSync(policyPath)) {
    console.error(
      "[opencode-orchestrator] ERROR: state ディレクトリに command-policy.json が見つかりません。" +
        "このタスクについて orch-planner フェーズ (Refiner/Spec-Checker/Preflight) を完了させてから loop を開始してください。",
    );
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(policyPath, "utf8");
  } catch (err) {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json の読み取りに失敗しました:",
      (err as Error).message || err,
    );
    process.exit(1);
  }

  let version: number | undefined;
  let status: string | undefined;
  let helperAvailability:
    | Record<string, "available" | "unavailable">
    | undefined;
  let commands:
    | {
        id?: string;
        command?: string;
        role?: string;
        usage?: string;
        availability?: "available" | "unavailable";
        related_requirements?: string[];
        probe_command?: string;
        parameters?: Record<string, { description?: string }>;
        usage_notes?: string;
      }[]
    | undefined;
  try {
    const json = JSON.parse(raw) as {
      version?: number;
      summary?: {
        loop_status?: string;
        helper_availability?: Record<string, "available" | "unavailable">;
      };
      commands?: {
        id?: string;
        command?: string;
        role?: string;
        usage?: string;
        availability?: "available" | "unavailable";
        related_requirements?: string[];
        probe_command?: string;
        parameters?: Record<string, { description?: string }>;
        usage_notes?: string;
      }[];
    };
    version = json.version;
    status = json && json.summary ? json.summary.loop_status : undefined;
    helperAvailability =
      json && json.summary && json.summary.helper_availability
        ? json.summary.helper_availability
        : undefined;
    commands = Array.isArray(json.commands) ? json.commands : undefined;
  } catch (err) {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json を JSON としてパースできませんでした:",
      (err as Error).message || err,
    );
    process.exit(1);
  }

  if (version !== 1) {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.version は 1 である必要があります。",
    );
    process.exit(1);
  }

  if (!helperAvailability || typeof helperAvailability !== "object") {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.summary.helper_availability が存在しません。" +
        "Planner/Preflight フェーズで helper コマンドの利用可否を設定してから loop を開始してください。",
    );
    process.exit(1);
  }

  if (typeof status !== "string") {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.summary.loop_status が存在しません。",
    );
    process.exit(1);
  }

  if (!Array.isArray(commands)) {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.commands が配列として存在する必要があります。",
    );
    process.exit(1);
  }

  for (const helperId of requiredHelperIds) {
    const availability = helperAvailability[helperId];
    if (availability !== "available" && availability !== "unavailable") {
      console.error(
        `[opencode-orchestrator] ERROR: command-policy.json.summary.helper_availability.${helperId} が存在しません。`,
      );
      process.exit(1);
    }
  }

  if (commands.length > 0) {
    for (const cmd of commands) {
      const hasValidParameters =
        !!cmd.parameters &&
        typeof cmd.parameters === "object" &&
        Object.values(cmd.parameters).every(
          (meta) =>
            !!meta &&
            typeof meta === "object" &&
            typeof meta.description === "string",
        );
      const hasValidRelatedRequirements =
        Array.isArray(cmd.related_requirements) &&
        cmd.related_requirements.every((item) => typeof item === "string");

      if (
        typeof cmd.id !== "string" ||
        typeof cmd.command !== "string" ||
        typeof cmd.role !== "string" ||
        typeof cmd.usage !== "string" ||
        (cmd.availability !== "available" &&
          cmd.availability !== "unavailable") ||
        typeof cmd.probe_command !== "string" ||
        typeof cmd.usage_notes !== "string" ||
        !hasValidParameters ||
        !hasValidRelatedRequirements
      ) {
        console.error(
          "[opencode-orchestrator] ERROR: command-policy.json.commands[] の各エントリには id, command, role, usage, availability, related_requirements, probe_command, parameters, usage_notes がすべて定義されている必要があります。",
        );
        process.exit(1);
      }
    }

    const blocking = commands.filter((cmd) => {
      const usage = cmd.usage;
      const availability = cmd.availability;
      return usage === "must_exec" && availability !== "available";
    });

    if (blocking.length > 0) {
      console.error(
        "[opencode-orchestrator] command-policy ゲート: 一部の must_exec コマンドが available になっていません:",
      );
      for (const cmd of blocking) {
        console.error(
          `  - ${cmd.command || "<unknown>"} (usage=${cmd.usage}, availability=${cmd.availability})`,
        );
      }
      console.error(
        "[opencode-orchestrator] 少なくとも 1 つの must_exec コマンドが available ではありません。" +
          "spec の見直しや preflight の再実行などで command-policy.json を更新してから loop を開始してください。",
      );
      process.exit(1);
    }
  }

  if (status === "ready_for_loop") {
    return;
  }

  if (status === "needs_refinement") {
    console.error(
      "[opencode-orchestrator] command-policy.loop_status=needs_refinement; " +
        "acceptance-index やコマンド仕様の見直しが必要なため、まだ loop は開始できません。",
    );
    process.exit(1);
  }

  if (status === "blocked_by_environment") {
    console.error(
      "[opencode-orchestrator] command-policy.loop_status=blocked_by_environment; " +
        "このストーリーの実行に必須なツールが環境に存在しないため、現在の環境では loop を開始できません。",
    );
    process.exit(1);
  }

  console.error(
    `[opencode-orchestrator] command-policy.loop_status=${status}; この状態では loop を開始できません。` +
      "planning / preflight フェーズを通じて command-policy.json を更新してから再実行してください。",
  );
  process.exit(1);
}
