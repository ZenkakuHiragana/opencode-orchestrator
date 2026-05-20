import * as path from "node:path";

import type { LoopOptions } from "./cli-args.js";
import { t } from "./i18n/messages.js";
import {
  createProposalEntry,
  hasOpenNonAutoResolvableProposals,
  loadProposals,
  resolveMatchingOpenAutoResolvableProposals,
  saveProposals,
} from "./orchestrator-proposals.js";
import { findSessionIdByTitle } from "./orchestrator-session.js";
import type { ExecutorAuditorStepResult } from "./orchestrator-step-types.js";
import type {
  ExecutorStepSnapshot,
  OrchestratorStatus,
} from "./orchestrator-status.js";
import {
  getExecutorVerificationEvidence,
  parseExecutorStepSnapshot,
  saveStatusJson,
} from "./orchestrator-status.js";
import {
  loadAcceptanceRequirementIds,
  normalizeRequirementIds,
  runAuditorPass,
} from "./orchestrator-step-auditor.js";
import { ensureFailureBudget } from "./orchestrator-step-recovery.js";
import { hasPersistedVerificationEvidence } from "./orchestrator-step-todo-state.js";

export async function handleExecutorSnapshotAndAudit(
  opts: LoopOptions,
  step: number,
  sessionId: string,
  fileArgs: string[],
  auditRaw: string,
  status: OrchestratorStatus,
  statusPath: string,
  restartCount: number,
  forceTodoWriterNextStep: boolean,
  execStdout: string,
): Promise<ExecutorAuditorStepResult> {
  const failureBudget = ensureFailureBudget(status);
  const stepSnapshot: ExecutorStepSnapshot = parseExecutorStepSnapshot(
    execStdout,
    sessionId,
    step,
  );
  status.last_executor_step = stepSnapshot;
  let needReplanProposal = null;
  let contractGapProposal = null;

  if (!stepSnapshot.step_intent || !stepSnapshot.step_verify) {
    failureBudget.consecutive_contract_gaps += 1;
    failureBudget.last_failure_kind = "executor_contract_gap";
    failureBudget.last_failure_summary =
      "executor が必須の STEP_INTENT / STEP_VERIFY 行を出力しなかった";
    if (failureBudget.consecutive_contract_gaps >= 2) {
      forceTodoWriterNextStep = true;
      contractGapProposal = createProposalEntry({
        source: "executor",
        cycle: step,
        kind: "contract_gap",
        priority: "medium",
        summary:
          "executor の step 出力契約が連続で不足しているため、todo と検証境界を再計画したい",
        details:
          "executor の出力が不足している。各 step で STEP_INTENT と STEP_VERIFY を必ず出力できるように todo と検証境界を明確にしたい",
        related_requirement_ids:
          stepSnapshot.step_audit?.requirement_ids ??
          stepSnapshot.step_intent?.requirement_ids ??
          [],
        related_todo_ids: [],
        auto_resolvable: true,
      });
    }
  } else {
    failureBudget.consecutive_contract_gaps = 0;
  }
  const otherBlockers = stepSnapshot.step_blocker.filter(
    (b: ExecutorStepSnapshot["step_blocker"][number]) =>
      b.tag && b.tag !== "need_replan",
  );

  const proposalsPath = path.join(path.dirname(statusPath), "proposals.json");
  let stepProposalFile = loadProposals(proposalsPath);
  let stepProposalChanged = false;

  for (const blocker of otherBlockers) {
    if (blocker.tag !== "scope_change" && blocker.tag !== "priority_shift") {
      continue;
    }
    stepProposalFile.proposals.push(
      createProposalEntry({
        source: "executor",
        cycle: step,
        kind: blocker.tag,
        priority: blocker.tag === "priority_shift" ? "low" : "medium",
        summary: blocker.reason,
        details: `${blocker.scope}: ${blocker.tag}: ${blocker.reason}`,
        related_requirement_ids:
          stepSnapshot.step_audit?.requirement_ids ??
          stepSnapshot.step_intent?.requirement_ids ??
          [],
        related_todo_ids: blocker.scope !== "general" ? [blocker.scope] : [],
        auto_resolvable: true,
      }),
    );
    stepProposalChanged = true;
    forceTodoWriterNextStep = true;
  }

  for (const line of execStdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("STEP_BLOCKER:")) continue;
    const rest = trimmed.slice("STEP_BLOCKER:".length).trim();
    if (!rest) continue;
    const firstSpace = rest.indexOf(" ");
    if (firstSpace === -1) continue;
    const scope = rest.slice(0, firstSpace).trim();
    const restAfterScope = rest.slice(firstSpace + 1).trim();
    const secondSpace = restAfterScope.indexOf(" ");
    if (secondSpace === -1) continue;
    const tag = restAfterScope.slice(0, secondSpace).trim();
    if (tag === "need_replan") {
      forceTodoWriterNextStep = true;
      needReplanProposal = createProposalEntry({
        source: "executor",
        cycle: step,
        kind: "need_replan",
        priority: "high",
        summary: restAfterScope.slice(secondSpace + 1).trim(),
        details: `${scope}: ${tag}: ${restAfterScope.slice(secondSpace + 1).trim()}`,
        related_requirement_ids:
          stepSnapshot.step_audit?.requirement_ids ??
          stepSnapshot.step_intent?.requirement_ids ??
          [],
        related_todo_ids: scope !== "general" ? [scope] : [],
        auto_resolvable: true,
      });
      console.error(
        `[opencode-orchestrator] executor から ${scope} need_replan の STEP_BLOCKER が出力されたため、次のステップで todo-writer を強制実行します。`,
      );
      break;
    }
  }

  let shouldAudit = false;
  let auditParseError: string | null = null;
  let lastAuditStatus: string | null = null;
  let lastAuditIds: string | null = null;
  let verificationGapProposal = null;
  for (const line of execStdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("STEP_AUDIT:")) continue;
    const rest = trimmed.slice("STEP_AUDIT:".length).trim();
    if (!rest) continue;
    const firstSpace = rest.indexOf(" ");
    if (firstSpace === -1) continue;
    const statusVal = rest.slice(0, firstSpace).trim();
    const ids = rest.slice(firstSpace + 1).trim();
    lastAuditStatus = statusVal;
    lastAuditIds = ids || null;
  }

  if (lastAuditStatus === "ready") {
    const verificationEvidence = getExecutorVerificationEvidence(stepSnapshot);
    const stateDir = path.dirname(statusPath);
    const hasPersistedEvidence = hasPersistedVerificationEvidence(stateDir);
    if (
      stepSnapshot.step_verify?.status === "ready" &&
      (verificationEvidence.hasEvidence || hasPersistedEvidence)
    ) {
      failureBudget.consecutive_verification_gaps = 0;
      shouldAudit = true;
      if (lastAuditIds && lastAuditIds !== "-") {
        console.error(
          `[opencode-orchestrator] executor が監査対象として報告した要件 ID: ${lastAuditIds}`,
        );
      } else {
        console.error(
          "[opencode-orchestrator] executor が監査準備完了を報告しました (特定の要件 ID は指定されていません)。",
        );
      }
    } else {
      failureBudget.consecutive_verification_gaps += 1;
      failureBudget.last_failure_kind = "verification_gap";
      failureBudget.last_failure_summary =
        "STEP_AUDIT: ready が出たが STEP_VERIFY の根拠が不足している";
      const evidenceHint =
        verificationEvidence.reason === "missing"
          ? "command id・差分確認・no-command 理由のいずれかを明示したい"
          : `verification evidence=${verificationEvidence.reason}`;
      console.error(
        "[opencode-orchestrator] STEP_VERIFY の根拠が不足したまま STEP_AUDIT: ready が出力されたため、このステップでは auditor をスキップします。",
      );
      if (failureBudget.consecutive_verification_gaps >= 2) {
        forceTodoWriterNextStep = true;
        verificationGapProposal = createProposalEntry({
          source: "executor",
          cycle: step,
          kind: "verification_gap",
          priority: "medium",
          summary:
            "監査準備の自己検証が連続で不足しているため、todo の証拠境界を再計画したい",
          details: `監査準備を宣言したが自己検証の根拠が不足している。STEP_VERIFY に command id・差分確認・no-command 理由を結び付け、必要なら todo を監査証拠単位で再分解したい (${evidenceHint})`,
          related_requirement_ids:
            lastAuditIds && lastAuditIds !== "-"
              ? lastAuditIds
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0)
              : [],
          related_todo_ids: [],
          auto_resolvable: true,
        });
      }
    }
  } else {
    failureBudget.consecutive_verification_gaps = 0;
  }

  const envBlockedBlockers = otherBlockers.filter(
    (b: ExecutorStepSnapshot["step_blocker"][number]) =>
      b.tag === "env_blocked",
  );
  const envBlockedReasonFromExecutor = envBlockedBlockers[0]?.reason;
  const envBlockedReason =
    auditParseError ?? envBlockedReasonFromExecutor ?? undefined;
  if (envBlockedReason) {
    const prevEnvBlocked = status.consecutive_env_blocked ?? 0;
    status.consecutive_env_blocked = prevEnvBlocked + 1;
    failureBudget.consecutive_env_blocked = status.consecutive_env_blocked;
    failureBudget.last_failure_kind = "env_blocked";
    failureBudget.last_failure_summary = envBlockedReason;
    if (status.consecutive_env_blocked >= 3) {
      if (envBlockedBlockers.length > 0) {
        for (const blocker of envBlockedBlockers) {
          stepProposalFile.proposals.push(
            createProposalEntry({
              source: "executor",
              cycle: step,
              kind: "env_blocked",
              priority: "critical",
              summary:
                "環境依存のエラー (env_blocked) が 3 回連続で発生し、Executor ループを継続できません。必須コマンドや command-policy の前提を見直してほしい。",
              details: `${blocker.scope}: ${blocker.tag}: ${blocker.reason}`,
              related_requirement_ids:
                stepSnapshot.step_audit?.requirement_ids ??
                stepSnapshot.step_intent?.requirement_ids ??
                [],
              related_todo_ids:
                blocker.scope !== "general" ? [blocker.scope] : [],
              auto_resolvable: false,
            }),
          );
        }
      } else {
        stepProposalFile.proposals.push(
          createProposalEntry({
            source: "auditor",
            cycle: step,
            kind: "env_blocked",
            priority: "critical",
            summary:
              "監査結果の解析に繰り返し失敗し、環境状態を正しく判定できません。acceptance-index/spec.md と command-policy を見直してほしい。",
            details: envBlockedReason,
            related_requirement_ids:
              stepSnapshot.step_audit?.requirement_ids ??
              stepSnapshot.step_intent?.requirement_ids ??
              [],
            related_todo_ids: [],
            auto_resolvable: false,
          }),
        );
      }
      stepProposalChanged = true;
    }
  } else {
    status.consecutive_env_blocked = 0;
    failureBudget.consecutive_env_blocked = 0;
  }

  let stepDone = false;
  if (shouldAudit) {
    const stateDir = path.dirname(statusPath);
    const fullRequirementIds = loadAcceptanceRequirementIds(stateDir);
    const incrementalScopeIds = normalizeRequirementIds(
      (stepSnapshot.step_audit?.requirement_ids?.length ?? 0) > 0
        ? (stepSnapshot.step_audit?.requirement_ids ?? [])
        : (stepSnapshot.step_intent?.requirement_ids ?? []),
    );
    const effectiveIncrementalScopeIds =
      incrementalScopeIds.length > 0 ? incrementalScopeIds : fullRequirementIds;

    if (incrementalScopeIds.length === 0 && fullRequirementIds.length > 0) {
      console.error(
        `[opencode-orchestrator] executor が監査対象 ID を明示しなかったため、incremental audit は full acceptance set にフォールバックします: ${fullRequirementIds.join(", ")}`,
      );
    }

    let activeAudit = await runAuditorPass(
      opts,
      step,
      fileArgs,
      auditRaw,
      "incremental",
      effectiveIncrementalScopeIds,
      findSessionIdByTitle,
    );

    const incrementalPassedAllScopedRequirements =
      !activeAudit.parseError && activeAudit.failed.length === 0;

    if (incrementalPassedAllScopedRequirements) {
      console.error(
        "[opencode-orchestrator] incremental audit passed for the executor-declared scope. Running final full audit before authorizing loop completion.",
      );
      activeAudit = await runAuditorPass(
        opts,
        step,
        fileArgs,
        auditRaw,
        "final_full",
        fullRequirementIds,
        findSessionIdByTitle,
      );
    }

    auditParseError = activeAudit.parseError;
    stepDone = activeAudit.done;
    if (activeAudit.parseError) {
      console.error(
        `[opencode-orchestrator] auditor の出力をパースできませんでした: ${activeAudit.parseError}`,
      );
    }
    if (activeAudit.done) {
      failureBudget.consecutive_audit_failures = 0;
    } else {
      failureBudget.consecutive_audit_failures += 1;
      failureBudget.last_failure_kind = "audit_failed";
      failureBudget.last_failure_summary =
        activeAudit.failed[0]?.reason || "auditor が未達要件を報告した";
    }
    console.error(`[opencode-orchestrator] auditor done = ${stepDone}`);

    status.last_auditor_report = activeAudit.report;

    if (activeAudit.failed.length > 0) {
      const ids = activeAudit.failed.map((f) => f.id).join(", ");
      console.error(
        `[opencode-orchestrator] auditor が未達と判定した要件: ${ids}`,
      );
      for (const f of activeAudit.failed) {
        if (!f.reason) continue;
        const firstLine = String(f.reason).split(/\r?\n/, 1)[0];
        console.error(`[opencode-orchestrator]   - ${f.id}: ${firstLine}`);
        const detailsParts: string[] = [f.reason];
        if (f.failure_kind) {
          detailsParts.push(`[failure_kind: ${f.failure_kind}]`);
        }
        if (f.evidence_gaps && f.evidence_gaps.length > 0) {
          detailsParts.push(`Evidence gaps: ${f.evidence_gaps.join("; ")}`);
        }
        stepProposalFile.proposals.push(
          createProposalEntry({
            source: "auditor",
            cycle: step,
            kind: "audit_failure",
            priority: "high",
            summary: firstLine,
            details: detailsParts.join("\n"),
            related_requirement_ids: [f.id],
            related_todo_ids: [],
            auto_resolvable: true,
          }),
        );
      }
      stepProposalChanged = true;
      forceTodoWriterNextStep = true;
    }

    if (activeAudit.passed.length > 0) {
      console.error(
        `[opencode-orchestrator] auditor が達成済みと判定した要件: ${activeAudit.passed.join(", ")}`,
      );
    }
  } else if (lastAuditStatus === "ready") {
    console.error(
      "[opencode-orchestrator] STEP_AUDIT: ready だが STEP_VERIFY の証拠不足のため、このステップでは auditor を起動しません。",
    );
  } else {
    console.error(
      "[opencode-orchestrator] このステップでは executor から STEP_AUDIT: ready が出ていないため、auditor は起動しません。",
    );
  }

  saveStatusJson(statusPath, status);

  if (needReplanProposal) {
    const currentReqKey = [...needReplanProposal.related_requirement_ids]
      .sort()
      .join(",");
    const currentTodoKey = [...needReplanProposal.related_todo_ids]
      .sort()
      .join(",");
    stepProposalFile = resolveMatchingOpenAutoResolvableProposals(
      stepProposalFile,
      (proposal) =>
        proposal.source === needReplanProposal.source &&
        proposal.kind === needReplanProposal.kind &&
        proposal.cycle < step &&
        ((proposal.related_requirement_ids.length > 0 &&
          [...proposal.related_requirement_ids].sort().join(",") ===
            currentReqKey) ||
          (proposal.related_requirement_ids.length === 0 &&
            [...proposal.related_todo_ids].sort().join(",") ===
              currentTodoKey)),
      "auto",
      new Date().toISOString(),
    );
    stepProposalFile.proposals.push(needReplanProposal);
  }
  if (contractGapProposal) {
    stepProposalFile.proposals.push(contractGapProposal);
  }
  if (verificationGapProposal) {
    stepProposalFile.proposals.push(verificationGapProposal);
  }
  if (needReplanProposal || contractGapProposal || verificationGapProposal) {
    stepProposalChanged = true;
  }
  if (stepProposalChanged) {
    saveProposals(proposalsPath, stepProposalFile);
  }
  const currentProposalsFile = loadProposals(proposalsPath);
  if (hasOpenNonAutoResolvableProposals(currentProposalsFile)) {
    console.error(
      "[opencode-orchestrator] proposals.json に未解決の非自動解決 proposal が存在するため、ループを停止します。",
    );
    console.error(
      "[opencode-orchestrator] このループ実行中に記録された proposal:",
    );
    for (const p of currentProposalsFile.proposals.filter(
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
    return {
      sessionId,
      restartCount,
      forceTodoWriterNextStep,
      done: stepDone,
      abortLoop: true,
      skipAuditorThisStep: false,
    };
  }

  return {
    sessionId,
    restartCount,
    forceTodoWriterNextStep,
    done: stepDone,
    abortLoop: false,
    skipAuditorThisStep: false,
  };
}
