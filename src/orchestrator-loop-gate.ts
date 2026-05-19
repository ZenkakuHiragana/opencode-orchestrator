import * as fs from "node:fs";
import * as path from "node:path";

import helperCommandsData from "../resources/helper-commands.json" with { type: "json" };

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
  let availableHelperCommands: string[] | undefined;
  let lastSpecCheckStatus: string | undefined;
  let lastSpecCheckFeasibleForLoop: boolean | undefined;
  let blockingFailureTypes: string[] | undefined;
  let blockingIssueIds: string[] | undefined;
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
        available_helper_commands?: string[];
        last_spec_check_status?: string;
        last_spec_check_feasible_for_loop?: boolean;
        blocking_failure_types?: string[];
        blocking_issue_ids?: string[];
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
    availableHelperCommands =
      json && json.summary && json.summary.available_helper_commands
        ? json.summary.available_helper_commands
        : undefined;
    lastSpecCheckStatus =
      json && json.summary ? json.summary.last_spec_check_status : undefined;
    lastSpecCheckFeasibleForLoop =
      json && json.summary
        ? json.summary.last_spec_check_feasible_for_loop
        : undefined;
    blockingFailureTypes =
      json && json.summary ? json.summary.blocking_failure_types : undefined;
    blockingIssueIds =
      json && json.summary ? json.summary.blocking_issue_ids : undefined;
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

  if (!availableHelperCommands || !Array.isArray(availableHelperCommands)) {
    console.error(
      "[opencode-orchestrator] ERROR: command-policy.json.summary.available_helper_commands が存在しません。" +
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

  void requiredHelperIds;

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
    const missingSpecSummaryFields: string[] = [];
    if (typeof lastSpecCheckStatus !== "string") {
      missingSpecSummaryFields.push("last_spec_check_status");
    }
    if (typeof lastSpecCheckFeasibleForLoop !== "boolean") {
      missingSpecSummaryFields.push("last_spec_check_feasible_for_loop");
    }
    if (!Array.isArray(blockingFailureTypes)) {
      missingSpecSummaryFields.push("blocking_failure_types");
    }
    if (!Array.isArray(blockingIssueIds)) {
      missingSpecSummaryFields.push("blocking_issue_ids");
    }

    if (missingSpecSummaryFields.length > 0) {
      console.error(
        "[opencode-orchestrator] planning gate: command-policy.summary.loop_status=ready_for_loop ですが、planner-finalized spec-check summary が不足しています:" +
          ` ${missingSpecSummaryFields.join(", ")}. Planner/Spec-Checker/Preflight を再実行して command-policy.json.summary を更新してください。`,
      );
      process.exit(1);
    }

    if (
      !Array.isArray(blockingFailureTypes) ||
      !Array.isArray(blockingIssueIds)
    ) {
      throw new Error("unreachable: ready_for_loop summary arrays must exist");
    }

    const hasValidBlockingFailureTypes = blockingFailureTypes.every(
      (item) => typeof item === "string",
    );
    const hasValidBlockingIssueIds = blockingIssueIds.every(
      (item) => typeof item === "string",
    );
    if (!hasValidBlockingFailureTypes || !hasValidBlockingIssueIds) {
      const invalidFields = [
        !hasValidBlockingFailureTypes ? "blocking_failure_types" : null,
        !hasValidBlockingIssueIds ? "blocking_issue_ids" : null,
      ].filter((item): item is string => item !== null);
      console.error(
        "[opencode-orchestrator] planning gate: command-policy.summary.loop_status=ready_for_loop ですが、planner-finalized spec-check summary に不正な型があります:" +
          ` ${invalidFields.join(", ")}. command-policy.json.summary を再生成してください。`,
      );
      process.exit(1);
    }

    if (
      lastSpecCheckStatus !== "ok" ||
      lastSpecCheckFeasibleForLoop !== true ||
      blockingFailureTypes.length > 0 ||
      blockingIssueIds.length > 0
    ) {
      const contradictionReasons: string[] = [];
      if (lastSpecCheckStatus !== "ok") {
        contradictionReasons.push(
          `last_spec_check_status=${String(lastSpecCheckStatus)}`,
        );
      }
      if (lastSpecCheckFeasibleForLoop !== true) {
        contradictionReasons.push(
          `last_spec_check_feasible_for_loop=${String(lastSpecCheckFeasibleForLoop)}`,
        );
      }
      if (blockingFailureTypes.length > 0) {
        contradictionReasons.push(
          `blocking_failure_types=${blockingFailureTypes.join(",")}`,
        );
      }
      if (blockingIssueIds.length > 0) {
        contradictionReasons.push(
          `blocking_issue_ids=${blockingIssueIds.join(",")}`,
        );
      }
      console.error(
        "[opencode-orchestrator] planning gate: command-policy.summary.loop_status=ready_for_loop ですが、planner-finalized spec-check summary が矛盾しています:" +
          ` ${contradictionReasons.join("; ")}. Planner/Spec-Checker/Preflight の結果を見直して command-policy.json を更新してください。`,
      );
      process.exit(1);
    }

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
