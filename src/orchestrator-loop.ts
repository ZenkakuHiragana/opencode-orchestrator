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
      "[opencode-orchestrator] status.json.proposals is non-empty before starting a new session; refusing to start loop.",
    );
    console.error("[opencode-orchestrator] Proposals from previous runs:");
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
      "[opencode-orchestrator] Handle these proposals via orch-planner and clear them before rerunning the loop.",
    );
    return false;
  }

  if (!sessionId) {
    if (opts.continueLast) {
      if (!status.last_session_id) {
        throw new Error(
          "--continue specified but status.json has no last_session_id for this task",
        );
      }
      sessionId = status.last_session_id;
      console.error(
        `[opencode-orchestrator] continuing existing session: ${sessionId}`,
      );
    } else {
      sessionId = await createInitialSession(opts, logDir, fileArgs);
    }
  } else {
    console.error(
      `[opencode-orchestrator] using explicit session: ${sessionId}`,
    );
  }

  console.error(`[opencode-orchestrator] session id: ${sessionId}`);
  console.error(
    "[opencode-orchestrator] loop mode: the executor and auditor do the job sequentially.",
  );

  status.last_session_id = sessionId!;
  status.proposals = [];
  saveStatusJson(statusPath, status);

  let done = false;
  let restartCount = 0;
  let forceTodoWriterNextStep = false;

  for (let step = 1; step <= opts.maxLoop; step += 1) {
    console.error(
      `\n[opencode-orchestrator] === STEP ${step} (maxLoop=${opts.maxLoop}) ===`,
    );
    console.error(`[opencode-orchestrator] progress: ${step}/${opts.maxLoop}`);

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
      `[opencode-orchestrator] reached max-loop=${opts.maxLoop} without completion.`,
    );
  }

  const exportPath = path.join(
    logDir,
    `orchestrator_session_${Date.now().toString()}.json`,
  );
  console.error(
    `[opencode-orchestrator] exporting orchestrator session to ${exportPath}`,
  );
  const exportRes = await runOpencode(["export", sessionId!], undefined, false);
  if (exportRes.code === 0 && exportRes.stdout) {
    try {
      fs.writeFileSync(exportPath, exportRes.stdout, { encoding: "utf8" });
    } catch (err) {
      console.error(
        `[opencode-orchestrator] WARN: failed to write export file ${exportPath}: ${String(
          err,
        )}`,
      );
    }
  } else if (exportRes.code !== 0) {
    console.error(
      "[opencode-orchestrator] WARN: opencode export exited with non-zero status",
    );
  }

  if (done && opts.commitOnDone) {
    console.error(
      "[opencode-orchestrator] COMMIT_ON_DONE enabled; asking executor to create commits.",
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
        "[opencode-orchestrator] COMMIT_ON_DONE enabled but current directory is not a git repository; skipping commit prompt.",
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
      "[opencode-orchestrator] ERROR: command-policy.json not found in state directory. " +
        "Run the planning/spec-check/preflight phase (orch-planner) for this task before starting the loop.",
    );
    process.exit(1);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(policyPath, "utf8");
  } catch (err) {
    console.error(
      "[opencode-orchestrator] ERROR: failed to read command-policy.json:",
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
      "[opencode-orchestrator] ERROR: failed to parse command-policy.json as JSON:",
      (err as Error).message || err,
    );
    process.exit(1);
  }

  if (version !== 1) {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.version=1 is required.",
    );
    process.exit(1);
  }

  if (!helperAvailability || typeof helperAvailability !== "object") {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.summary.helper_availability is required. " +
        "Run the planning/preflight phase to populate helper availability before starting the loop.",
    );
    process.exit(1);
  }

  if (typeof status !== "string") {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.summary.loop_status is required.",
    );
    process.exit(1);
  }

  if (!Array.isArray(commands)) {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.commands is required.",
    );
    process.exit(1);
  }

  for (const helperId of requiredHelperIds) {
    const availability = helperAvailability[helperId];
    if (availability !== "available" && availability !== "unavailable") {
      console.error(
        `[opencode-orchestrator] ERROR: command-policy.json.summary.helper_availability.${helperId} is required.`,
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
          "[opencode-orchestrator] ERROR: every command-policy.json.commands[] entry must define id, command, role, usage, availability, related_requirements, probe_command, parameters, and usage_notes.",
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
        "[opencode-orchestrator] command-policy gate: some must_exec commands are not available:",
      );
      for (const cmd of blocking) {
        console.error(
          `  - ${cmd.command || "<unknown>"} (usage=${cmd.usage}, availability=${cmd.availability})`,
        );
      }
      console.error(
        "[opencode-orchestrator] At least one must_exec command is not marked as available; " +
          "refine the spec or ensure preflight passes before starting the executor loop.",
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
        "acceptance-index or command specification needs to be refined before running the executor loop.",
    );
    process.exit(1);
  }

  if (status === "blocked_by_environment") {
    console.error(
      "[opencode-orchestrator] command-policy.loop_status=blocked_by_environment; " +
        "the current environment is missing non-negotiable tools for this story.",
    );
    process.exit(1);
  }

  console.error(
    `[opencode-orchestrator] command-policy.loop_status=${status}; loop start is not allowed under this status. ` +
      "Update command-policy.json via the planning/preflight phase before retrying.",
  );
  process.exit(1);
}
