/**
 * VerifyRunnerService — orchestrates `lore verify`: runs a plan's script-mode
 * acceptance criteria for real and records the outcome as runner-attested evidence
 * (SPEC-039 §2; §M2 trust-hardening).
 *
 * Public surface:
 *   verifyPlan(planIdOrSlug, opts) → runs every (or a filtered subset of) script-mode
 *     AC declared on the plan's parent spec against the resolved target task
 *
 * Four-step pipeline, fully delegated (SPEC-039 §2), with an M2 pre-execution gate
 * inserted into step ③:
 *   ① injected `getPlanBundle` — read orchestration (bound to
 *      `corpusService.getPlanBundle`, mirroring `resolveDeclaredAcIds`'s bind-in-app.ts
 *      precedent, SPEC-038 §7 D4)
 *   ② core `resolveTargetTask` (`@lore/core`, pure) — explicit `--task` override wins;
 *      otherwise the plan's sole fresh (non-stale) claim; 0 or >1 candidates fail loud
 *   ②.5 M2 command-provenance approval gate (core `isApprovedVerifyCommand`, pure) —
 *      a command absent from the target task's evidence history is "new/changed" and
 *      requires explicit approval (interactive `opts.confirmUnapprovedCommand` or
 *      `opts.allowNewCommands`) before step ③ runs for that AC; disabled entirely via
 *      `config.requireCommandApproval: false`
 *   ③ injected `executor` — runs the spawn spec (bound to
 *      `verify-executor.ts::executeVerifySpawnSpec` in production), with a
 *      pre-resolved env map (`resolveVerifyEnv`, computed ONCE per run — SPEC-039 §M2)
 *   ④ injected `recordVerifiedEvidence` — the SOLE attestation injection point (bound
 *      to `taskWorkflowService.recordVerifiedEvidence`); the recorded attestation
 *      carries `first_seen: true` when step ②.5 found the command new/changed (M2
 *      command-provenance annotation)
 *
 * Invariants:
 *   - Never imports `verify-executor.ts` (bun-only) — the executor is a constructor
 *     port, so this service (and its vitest suite) stays fully bun-independent
 *     (SPEC-039 §2 D3).
 *   - Never touches doc status, never auto-approves anything (SPEC-039 §1 — "runner
 *     不自动改任何 doc 状态、不 approve", PRD §14 R2 red line).
 *   - A launch-failure `err` from the executor ABORTS the entire run — no partial
 *     ambiguity. The error message names every AC id already recorded before the
 *     abort (SPEC-039 §4 D6 "fail-loud, 不留部分歧义"). A REJECTED command-provenance
 *     approval (M2) aborts the SAME way, with the same "already recorded" accounting
 *     — `err({code: "NEEDS_APPROVAL", ...})` instead of `STORE_ERROR`.
 *   - A `spec` whose status is not `approved`/`active` still runs in full — this is
 *     advisory (`result.warnings`), never a hard gate (SPEC-039 §3 "draft spec 的
 *     AC → 执行 + stderr 警告行(不硬闸)").
 *   - `ai`/`human`-mode criteria in the (optionally `acIds`-filtered) selection are
 *     never executed — they are reported in `result.skipped`, never silently dropped.
 *   - `resolveVerifyEnv` is called EXACTLY ONCE per `verifyPlan` invocation (env
 *     doesn't vary per-AC) — never re-derived inside the per-AC loop.
 *   - `opts.confirmUnapprovedCommand` is a PER-CALL option, not constructor DI — the
 *     CLI wires a TTY-aware prompt callback, MCP never supplies one (non-interactive
 *     by design); `createApp`/`app.ts` stays adapter-agnostic (SPEC-039 §M2).
 *
 * Side-effect class: IO (delegates all IO to injected ports; this class itself has none)
 *
 * Source: SPEC-039 §2 D2, D3, D4, D6, D9; §3; §4 AC-VRF-3; §M2 (trust-hardening: env
 *   allowlist + command-provenance approval + annotation)
 */

import { err, ok } from "@lore/core";
import type { Result, LoreError, DocId, DocRecord, PlanBundle } from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  resolveTargetTask,
  isApprovedVerifyCommand,
  type AcVerifyMode,
} from "@lore/core";
import {
  buildVerifySpawnSpec,
  deriveVerifyResult,
  resolveVerifyEnv,
  type ScriptAcceptanceCriterion,
  type VerifySpawnSpec,
  type VerifyExecutionResult,
} from "./verify-spawn.js";
import type { VerifiedEvidenceInput } from "./task-workflow-service.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Options for {@link VerifyRunnerService.verifyPlan}. */
export interface VerifyPlanOpts {
  /** Restrict the run to these declared AC ids. Omitted = every declared AC on the spec. */
  acIds?: string[];
  /** `--task` override — wins over claim-based resolution regardless of claim state. */
  explicitTaskIdOrSlug?: string;
  /** Resolved actor identity, recorded as `recorded_by` on every evidence entry. */
  by: string;
  /** Caller-supplied current time (D10 time seam) — resolved ONCE per call. */
  nowIso: string;
  /**
   * Bypass the M2 command-provenance approval gate for this ENTIRE run — every
   * new/changed command executes without a prompt (CLI `--allow-new-commands`,
   * MCP `allow_new_commands`). `true` wins over `confirmUnapprovedCommand` (no
   * prompt fires even if a callback is also supplied). Ignored when
   * `config.requireCommandApproval` is `false` (the gate is off entirely).
   */
  allowNewCommands?: boolean;
  /**
   * Interactive per-command confirmation hook (SPEC-039 §M2) — invoked ONLY when
   * an AC's command is new/changed AND `allowNewCommands` is not `true` AND the
   * gate is enabled. CLI-only: wired to a TTY prompt when `process.stdin.isTTY`
   * and not `--json`; MCP NEVER supplies this (non-interactive by design — an
   * unapproved command with no callback and no `allowNewCommands` is rejected
   * outright). Resolving `false` (or the promise resolving falsy) aborts the run
   * at that AC with `NEEDS_APPROVAL`.
   */
  confirmUnapprovedCommand?: (info: { ac_id: string; command: string }) => Promise<boolean>;
}

/** One executed script-mode AC's outcome. */
export interface VerifyAcResult {
  readonly ac_id: string;
  readonly result: "pass" | "fail";
  readonly exit_code: number;
  readonly duration_ms: number;
  readonly timed_out: boolean;
  /**
   * true iff this command was new/changed relative to the task's evidence history
   * at execution time (SPEC-039 §M2 command-provenance annotation) — mirrors
   * `EvidenceEntry.attestation.first_seen`. Omitted (never `false`) for a
   * previously-seen command.
   */
  readonly first_seen?: boolean;
}

/** One declared AC that was NOT executed because its verify.mode isn't "script". */
export interface VerifySkippedAc {
  readonly ac_id: string;
  readonly mode: Exclude<AcVerifyMode, "script">;
}

/** Full outcome of one {@link VerifyRunnerService.verifyPlan} call. */
export interface VerifyPlanResult {
  /** The task every recorded evidence entry in `results` was attributed to. */
  readonly task: { id: DocId; slug: string };
  readonly results: VerifyAcResult[];
  readonly skipped: VerifySkippedAc[];
  /** Advisory notes (e.g. "parent spec not approved") — never affects `results`. */
  readonly warnings: string[];
}

// ─── VerifyRunnerService ───────────────────────────────────────────────────

export class VerifyRunnerService {
  /**
   * @param getPlanBundle - Bound port resolving `{plan, spec?, tasks[]}`; production
   *   wiring is `corpusService.getPlanBundle.bind(corpusService)` (app.ts). This
   *   service never imports CorpusService directly (services don't cross-import).
   * @param recordVerifiedEvidence - Bound port appending runner-attested evidence;
   *   production wiring is `taskWorkflowService.recordVerifiedEvidence.bind(taskWorkflowService)`.
   *   This is the SOLE way `attestation` reaches storage (SPEC-039 §2 D2) — no other
   *   code path in this service touches evidence directly.
   * @param executor - Bound port running one spawn spec; production wiring is
   *   `verify-executor.ts::executeVerifySpawnSpec`. Injected (not imported) so this
   *   service and its tests never depend on the bun-only executor module (D3).
   * @param config - `{ repoRoot, defaultTimeoutMs, claimTtlMinutes, requireCommandApproval,
   *   envAllowlist, envPassthroughAll, processEnv }` — scalar config, not a behavioral
   *   port; `repoRoot` and `defaultTimeoutMs` feed `buildVerifySpawnSpec`,
   *   `claimTtlMinutes` feeds `resolveTargetTask`'s staleness check (same TTL
   *   TaskWorkflowService and CorpusService already resolve via `resolveClaimTtlMinutes`
   *   — one resolution path, not a second config read). SPEC-039 §M2 additions:
   *   `requireCommandApproval` gates step ②.5 (resolved via
   *   `resolveVerifyRequireCommandApproval(config)` in `@lore/core`);
   *   `envAllowlist`/`envPassthroughAll` (resolved via `resolveVerifyEnvConfig`) and
   *   `processEnv` (a captured `process.env` snapshot — `app.ts` composition time,
   *   mirroring how `repoRoot` is captured from `process.cwd()` there too) feed the
   *   ONE `resolveVerifyEnv` call made per `verifyPlan` invocation.
   */
  constructor(
    private readonly getPlanBundle: (
      planIdOrSlug: string,
    ) => Promise<Result<PlanBundle, LoreError>>,
    private readonly recordVerifiedEvidence: (
      idOrSlug: string,
      entry: VerifiedEvidenceInput,
      nowIso: string,
    ) => Promise<Result<DocRecord, LoreError>>,
    private readonly executor: (
      spec: VerifySpawnSpec,
    ) => Promise<Result<VerifyExecutionResult, LoreError>>,
    private readonly config: {
      repoRoot: string;
      defaultTimeoutMs: number;
      claimTtlMinutes: number;
      /** SPEC-039 §M2 — command-provenance approval gate on/off. Default true upstream (config schema). */
      requireCommandApproval: boolean;
      /** SPEC-039 §M2 — additive env-var allowlist beyond the built-in default set. */
      envAllowlist: string[];
      /** SPEC-039 §M2 — escape hatch restoring full env passthrough (bypasses the allowlist). */
      envPassthroughAll: boolean;
      /** SPEC-039 §M2 — parent environment snapshot fed to `resolveVerifyEnv`. */
      processEnv: Readonly<Record<string, string | undefined>>;
    },
  ) {}

  /**
   * Runs a plan's declared script-mode acceptance criteria for real and records
   * runner-attested evidence for each. See the class-level JSDoc for the four-step
   * pipeline and the module-level invariants (launch-failure abort semantics, the
   * draft-spec advisory, ai/human skip reporting).
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param opts - `{ acIds?, explicitTaskIdOrSlug?, by, nowIso, allowNewCommands?,
   *   confirmUnapprovedCommand? }`
   * @returns `VerifyPlanResult` — every recorded AC outcome, every skipped
   *   non-script AC, and any advisory warnings
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (plan has no parent spec / spec has no
   *   structured acceptance_criteria / unknown acIds / target-task ambiguity),
   *   STALE_VERSION (a concurrent writer raced an evidence write), STORE_ERROR
   *   (a script command failed to LAUNCH — the run aborts, no partial evidence
   *   ambiguity; the message lists every AC id already recorded before the abort),
   *   NEEDS_APPROVAL (SPEC-039 §M2 — a new/changed command was rejected by the
   *   command-provenance approval gate; same partial-completion accounting as the
   *   STORE_ERROR launch-failure abort)
   */
  async verifyPlan(
    planIdOrSlug: string,
    opts: VerifyPlanOpts,
  ): Promise<Result<VerifyPlanResult, LoreError>> {
    // ① bundle
    const bundleResult = await this.getPlanBundle(planIdOrSlug);
    if (!bundleResult.ok) return bundleResult;
    const { plan, spec, tasks } = bundleResult.value;

    if (spec === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "spec",
        message: `plan "${plan.slug}" has no parent spec — nothing to verify`,
        value: plan.id,
      });
    }

    const criteriaParsed = specAcceptanceCriteriaSchema.safeParse(
      spec.extra["acceptance_criteria"],
    );
    if (!criteriaParsed.success || criteriaParsed.data.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria",
        message: `spec "${spec.slug}" has no structured acceptance_criteria declared — nothing to verify`,
        value: spec.id,
      });
    }

    let selected = criteriaParsed.data;
    if (opts.acIds !== undefined) {
      const declaredIds = new Set(selected.map((c) => c.id));
      const unknown = opts.acIds.filter((id) => !declaredIds.has(id));
      if (unknown.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acIds",
          message: `unknown AC id(s) not declared on spec "${spec.slug}": ${unknown.join(", ")}`,
          value: unknown,
        });
      }
      const idSet = new Set(opts.acIds);
      selected = selected.filter((c) => idSet.has(c.id));
    }

    const scriptCriteria: ScriptAcceptanceCriterion[] = [];
    const skipped: VerifySkippedAc[] = [];
    for (const criterion of selected) {
      if (criterion.verify.mode === "script") {
        scriptCriteria.push(criterion as ScriptAcceptanceCriterion);
      } else {
        skipped.push({ ac_id: criterion.id, mode: criterion.verify.mode });
      }
    }

    // ② resolve target task (core, pure)
    const targetResult = resolveTargetTask(tasks, {
      ...(opts.explicitTaskIdOrSlug !== undefined
        ? { explicitTaskIdOrSlug: opts.explicitTaskIdOrSlug }
        : {}),
      nowIso: opts.nowIso,
      ttlMinutes: this.config.claimTtlMinutes,
    });
    if (!targetResult.ok) return targetResult;
    const task = targetResult.value;

    const warnings: string[] = [];
    if (spec.status !== "approved" && spec.status !== "active") {
      warnings.push(
        `Spec "${spec.slug}" is not approved/active (status: ${spec.status}) — ` +
          `lore verify still ran (SPEC-039 §3: not a hard gate).`,
      );
    }

    // SPEC-039 §M2 — env resolved EXACTLY ONCE per run (doesn't vary per-AC).
    const resolvedEnv = resolveVerifyEnv(this.config.processEnv, {
      allowlist: this.config.envAllowlist,
      passthroughAll: this.config.envPassthroughAll,
    });

    // ③④ execute + record, one script-mode AC at a time
    const results: VerifyAcResult[] = [];
    const completedAcIds: string[] = [];
    for (const criterion of scriptCriteria) {
      // ②.5 SPEC-039 §M2 — command-provenance approval gate. A command absent from
      // the task's evidence history is "new/changed"; `firstSeen` also feeds the
      // attestation annotation below REGARDLESS of whether the gate is enabled.
      const firstSeen = !isApprovedVerifyCommand(task, criterion.verify.command);
      if (this.config.requireCommandApproval && firstSeen && opts.allowNewCommands !== true) {
        const confirmed =
          opts.confirmUnapprovedCommand !== undefined
            ? await opts.confirmUnapprovedCommand({
                ac_id: criterion.id,
                command: criterion.verify.command,
              })
            : false;
        if (!confirmed) {
          // Fail-loud abort (SPEC-039 §4 D6 abort semantics, applied to the M2 gate)
          // — no partial ambiguity. Names every AC already recorded before the abort,
          // same accounting the launch-failure abort below uses.
          return err({
            code: "NEEDS_APPROVAL",
            message:
              `lore verify aborted at AC "${criterion.id}" — command is new/changed and was ` +
              `not approved. ${completedAcIds.length} AC(s) already recorded before the abort: ` +
              `${completedAcIds.length > 0 ? completedAcIds.join(", ") : "none"}. ` +
              "Pass --allow-new-commands (CLI) / allow_new_commands: true (MCP) to approve " +
              "automatically, or run interactively (TTY, no --json) to confirm.",
            command: criterion.verify.command,
            ac_id: criterion.id,
          });
        }
      }

      const spawnSpec = buildVerifySpawnSpec(criterion, {
        repoRoot: this.config.repoRoot,
        defaultTimeoutMs: this.config.defaultTimeoutMs,
        ...(resolvedEnv !== undefined ? { env: resolvedEnv } : {}),
      });

      const execResult = await this.executor(spawnSpec);
      if (!execResult.ok) {
        // Fail-loud abort (SPEC-039 §4 D6) — no partial ambiguity. Names every AC
        // already recorded (with attested evidence) before this abort.
        const detail =
          "message" in execResult.error ? execResult.error.message : execResult.error.code;
        return err({
          code: "STORE_ERROR",
          message:
            `lore verify aborted at AC "${criterion.id}" — command failed to launch (${detail}). ` +
            `${completedAcIds.length} AC(s) already recorded before the abort: ` +
            `${completedAcIds.length > 0 ? completedAcIds.join(", ") : "none"}.`,
        });
      }

      const { exitCode, outputTail, durationMs, timedOut } = execResult.value;
      const verifyResult = deriveVerifyResult(exitCode, timedOut);

      const recordResult = await this.recordVerifiedEvidence(
        task.id,
        {
          oracle: criterion.verify.oracle,
          command: criterion.verify.command,
          result: verifyResult,
          recorded_by: opts.by,
          ac_ref: criterion.id,
          ...(outputTail !== "" ? { output_tail: outputTail } : {}),
          attestation: {
            runner: "lore-cli",
            exit_code: exitCode,
            duration_ms: durationMs,
            timed_out: timedOut,
            // SPEC-039 §M2 — command-provenance annotation, present-iff-true.
            ...(firstSeen ? { first_seen: true } : {}),
          },
        },
        opts.nowIso,
      );
      if (!recordResult.ok) return recordResult;

      completedAcIds.push(criterion.id);
      results.push({
        ac_id: criterion.id,
        result: verifyResult,
        exit_code: exitCode,
        duration_ms: durationMs,
        timed_out: timedOut,
        ...(firstSeen ? { first_seen: true } : {}),
      });
    }

    return ok({ task: { id: task.id, slug: task.slug }, results, skipped, warnings });
  }
}
