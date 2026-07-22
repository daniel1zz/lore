/**
 * VerifyRunnerService — orchestrates `lore verify`: runs a plan's script-mode
 * acceptance criteria for real and records the outcome as runner-attested evidence
 * (SPEC-039 §2; §M2 trust-hardening; SPEC-061 attestation-completeness guard).
 *
 * Public surface:
 *   verifyPlan(planIdOrSlug, opts) → runs every (or a filtered subset of) script-mode
 *     AC declared on the plan's parent spec against the resolved target task
 *
 * Four-step pipeline, fully delegated (SPEC-039 §2), with an M2 pre-execution gate
 * inserted into step ③ and a SPEC-061 post-execution guard inserted into step ④:
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
 *   ③.4 build-freshness precheck (core `commandReferencesCompiledBinary` /
 *      `judgeBinaryFreshness`, both pure) — for ANY AC (regardless of oracle kind)
 *      whose command exited 0 and whose command string spawns the compiled
 *      `dist/lore` binary, checks whether that binary is stale/missing relative to
 *      this repo's TypeScript sources; a non-"fresh" verdict downgrades the
 *      about-to-be-recorded result to `"inconclusive"` PLUS a `warnings` entry
 *      naming `bun run build` (closes false-oracle vector 4 — a spawn-based test
 *      exercising a binary that predates the session's source changes). A command
 *      not referencing the binary skips this step entirely (no fs access at all —
 *      `checkBinaryFreshness` is never invoked). Runs BEFORE step ③.5 so an
 *      already-downgraded result short-circuits that step's own `"pass"`-only guard.
 *   ③.5 SPEC-061 attestation-completeness guard (core `countExplicitPathArgs` /
 *      `parseExecutedUnits` / `judgeCompleteness`, all pure) — for an `oracle: "test"`
 *      AC whose command exited 0, judges whether the runner actually executed as many
 *      test files (and, when a `-t`/`--testNamePattern` case filter is present, test
 *      CASES) as the command explicitly declared; a zero/under-match downgrades the
 *      about-to-be-recorded result from `"pass"` to `"inconclusive"` (never silently
 *      stays `"pass"` — the AC-060-7 false-attestation incident this guard closes).
 *      Every other oracle kind, and any non-zero exit, skips this step entirely (no
 *      `completeness` computed, no field written — byte-identical to pre-SPEC-061).
 *   ④ injected `recordVerifiedEvidence` — the SOLE attestation injection point (bound
 *      to `taskWorkflowService.recordVerifiedEvidence`); the recorded attestation
 *      carries `first_seen: true` when step ②.5 found the command new/changed (M2
 *      command-provenance annotation), `completeness`/`executed_files` when step
 *      ③.5 ran (SPEC-061), and ALWAYS `execution_root`/`execution_mode` (SPEC-063
 *      §Design Decisions D2/D3 — see `opts.executionRoot` below). Step ③.4's
 *      `binary_freshness` verdict is surfaced on the in-memory `VerifyAcResult` and
 *      the run's `warnings` ONLY — it is NOT persisted onto `attestation` (the
 *      `evidenceEntrySchema.attestation` shape lives outside this task's anchors;
 *      the downgraded `result`/the warning text are the durable signal).
 *
 * SPEC-063 execution-root correctness — `opts.executionRoot` (optional) is the
 * CLI adapter's pre-resolved `resolveVerifyExecutionRoot(...)` result (core, pure);
 * this service never probes git itself (stays free of git/process probing, per
 * the pre-existing invariant below). When omitted (MCP callers, which do no
 * worktree-aware resolution) this service falls back to `{root: config.repoRoot,
 * mode: "corpus_root"}` — byte-identical to pre-SPEC-063 behavior. Every AC's
 * command spawns from the resolved `root` (not unconditionally `config.repoRoot`
 * any more), and every recorded attestation carries `execution_root`/
 * `execution_mode` from the SAME resolution — closing the vector where a linked
 * git worktree's `lore verify` silently executed against the main checkout.
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
 *   - `checkBinaryFreshness` (constructor arg 5, OPTIONAL) is the build-freshness
 *     port — a `() => BinaryFreshnessVerdict` thunk, computed AT MOST ONCE per
 *     `verifyPlan` call (cached the same way `resolveVerifyEnv`/`executionRoot` are
 *     resolved once and threaded down) and ONLY when at least one AC's command
 *     references the compiled binary. Omitting it (every pre-Part-A call site,
 *     incl. `app.ts`'s existing 4-arg construction) falls back to a private
 *     `node:fs`-based real check (`newestTsMtimeMs` scan of `packages/{lore,core}/src`
 *     vs `<repoRoot>/dist/lore`'s mtime, mirroring
 *     `tests/integration/helpers/assert-fresh-binary.ts`'s algorithm) — this is the
 *     ONE place this class does direct filesystem IO itself, deliberately scoped to
 *     production use (every test in this class's suite injects a fake, per the
 *     `executor`/`getPlanBundle` precedent).
 *
 * Side-effect class: IO (delegates all IO to injected ports, EXCEPT the default
 *   `checkBinaryFreshness` fallback described above, which does direct `node:fs`
 *   reads when no port is injected)
 *
 * Source: SPEC-039 §2 D2, D3, D4, D6, D9; §3; §4 AC-VRF-3; §M2 (trust-hardening: env
 *   allowlist + command-provenance approval + annotation); SPEC-061 §Scope D3;
 *   SPEC-063 §Design Decisions D2, D3; task "verify trust extensions"
 *   (build-freshness precheck + -t matched-case count guard), AC-061-9
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { err, ok } from "@lore/core";
import type { Result, LoreError, DocId, DocRecord, PlanBundle } from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  resolveTargetTask,
  isApprovedVerifyCommand,
  countExplicitPathArgs,
  parseExecutedUnits,
  judgeCompleteness,
  commandHasCaseFilter,
  commandReferencesCompiledBinary,
  judgeBinaryFreshness,
  type AcVerifyMode,
  type CompletenessVerdict,
  type BinaryFreshnessVerdict,
  type VerifyExecutionRootResolution,
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
  /**
   * Pre-resolved execution root (SPEC-063 §Design Decisions D2) — the CLI
   * adapter's own `resolveVerifyExecutionRoot(...)` result (or its `--execution-root`
   * override composition), computed BEFORE calling `verifyPlan` since this
   * service never probes git/process state itself. Every AC's command spawns
   * from `executionRoot.root` (not unconditionally `config.repoRoot`), and
   * every recorded attestation carries `execution_root`/`execution_mode` from
   * this SAME value. Omitted (e.g. by MCP, which does no worktree-aware
   * resolution) falls back to `{root: config.repoRoot, mode: "corpus_root"}` —
   * byte-identical to pre-SPEC-063 behavior (REGRESSION, AC-063-3).
   */
  executionRoot?: VerifyExecutionRootResolution;
}

/** One executed script-mode AC's outcome. */
export interface VerifyAcResult {
  readonly ac_id: string;
  /**
   * `"inconclusive"` (SPEC-061 §Scope D3) is the attestation-completeness
   * guard's own verdict — set instead of `"pass"` when the command exited 0
   * but its declared test-file path arguments were not all matched by the
   * runner (zero-match or under-match). Never a caller assertion, same as
   * `"pass"`/`"fail"` — always derived by this service.
   */
  readonly result: "pass" | "fail" | "inconclusive";
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
  /**
   * Attestation-completeness verdict (SPEC-061 §Scope D3/D4) — present ONLY
   * for an `oracle: "test"` AC whose process exited 0 (the guard's own scope:
   * a nonzero exit is already a `"fail"`, completeness is irrelevant; every
   * other oracle kind is out of scope, SPEC-061 §Scope Out). Omitted for
   * every other AC.
   */
  readonly completeness?: CompletenessVerdict;
  /**
   * Count of test files the runner reported as actually executed (SPEC-061
   * §Scope D4) — present iff {@link completeness} is set AND a recognised
   * runner-summary line was parsed (absent when `completeness ===
   * "unknown_runner"`).
   */
  readonly executed_files?: number;
  /**
   * The command's own declared explicit test-file path-argument count
   * (SPEC-061 §Scope D1/D3) — present alongside {@link completeness}
   * whenever the guard ran, regardless of whether any files were parsed from
   * stdout; renders the "ran X of Y declared paths" CLI message even when
   * `executed_files` itself is absent (`unknown_runner`, X reads as unknown).
   */
  readonly declared_paths?: number;
  /**
   * Build-freshness verdict (Part A) — present ONLY when this AC's command
   * references the compiled `dist/lore` binary (`commandReferencesCompiledBinary`)
   * AND the process exited 0. `"stale"`/`"missing"` downgrade {@link result} to
   * `"inconclusive"` and add a `bun run build`-naming entry to the run's
   * `warnings`; `"fresh"` leaves {@link result} exactly as otherwise computed.
   * Omitted for every AC whose command does not reference the binary.
   */
  readonly binary_freshness?: BinaryFreshnessVerdict;
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
   * @param checkBinaryFreshness - OPTIONAL build-freshness port (Part A) — see the
   *   class-level Invariants entry. Omitted in every existing call site (`app.ts`'s
   *   4-arg construction stays valid); production code that DOES wire it would pass
   *   a thunk performing the real `stat()` calls. When omitted, this class falls
   *   back to its own private `node:fs`-based check computed against `config.repoRoot`.
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
    private readonly checkBinaryFreshness?: () => BinaryFreshnessVerdict,
  ) {}

  /**
   * Recursively finds the newest `mtimeMs` among `.ts` files under `dir`
   * (returns `0` when `dir` doesn't exist or contains none) — the same
   * algorithm `tests/integration/helpers/assert-fresh-binary.ts::newestTsMtimeMs`
   * uses, duplicated here (not imported — that module lives under `tests/`,
   * not `src/`) per the task's "leave the helper and just share the pure
   * predicate" guidance.
   */
  private static _newestTsMtimeMsUnder(dir: string): number {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      let newest = 0;
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const childNewest = VerifyRunnerService._newestTsMtimeMsUnder(fullPath);
          if (childNewest > newest) newest = childNewest;
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
          const mtimeMs = statSync(fullPath).mtimeMs;
          if (mtimeMs > newest) newest = mtimeMs;
        }
      }
      return newest;
    } catch {
      // reason: an unreadable/missing directory degrades to "no source files
      // found here" (0), never an exception — mirrors
      // assert-fresh-binary.ts's existsSync-guarded original, and keeps this
      // freshness check fail-open per the module's own invariant.
      return 0;
    }
  }

  /**
   * Default `checkBinaryFreshness` implementation — real `node:fs` reads
   * against `config.repoRoot`. Only ever called when the constructor received
   * no `checkBinaryFreshness` port AND at least one AC's command references
   * the compiled binary (`commandReferencesCompiledBinary`); every unit test
   * in this class's suite injects a fake port instead, so this method's own
   * filesystem access is exercised only in production.
   */
  private _computeRealBinaryFreshness(): BinaryFreshnessVerdict {
    const binPath = join(this.config.repoRoot, "dist", "lore");
    const binaryMtimeMs = existsSync(binPath) ? statSync(binPath).mtimeMs : null;
    const newestSourceMtimeMs = Math.max(
      VerifyRunnerService._newestTsMtimeMsUnder(join(this.config.repoRoot, "packages", "lore", "src")),
      VerifyRunnerService._newestTsMtimeMsUnder(join(this.config.repoRoot, "packages", "core", "src")),
    );
    return judgeBinaryFreshness({ binaryMtimeMs, newestSourceMtimeMs });
  }

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

    // SPEC-063 §Design Decisions D2 — resolved EXACTLY ONCE per run (doesn't vary
    // per-AC, same "resolve once, thread down" shape resolvedEnv below uses).
    // `opts.executionRoot` is the CLI adapter's own pre-resolution (this service
    // never probes git); its absence (e.g. an MCP caller) falls back to the
    // pre-SPEC-063 constant — byte-identical for that caller (REGRESSION,
    // AC-063-3). A fallback-triggered `warning` (an anomalous/unresolved git
    // probe) is surfaced the same way the draft-spec advisory above is.
    const resolvedExecutionRoot = opts.executionRoot ?? {
      root: this.config.repoRoot,
      mode: "corpus_root" as const,
    };
    if (resolvedExecutionRoot.warning !== undefined) {
      warnings.push(resolvedExecutionRoot.warning);
    }

    // SPEC-039 §M2 — env resolved EXACTLY ONCE per run (doesn't vary per-AC).
    const resolvedEnv = resolveVerifyEnv(this.config.processEnv, {
      allowlist: this.config.envAllowlist,
      passthroughAll: this.config.envPassthroughAll,
    });

    // ③④ execute + record, one script-mode AC at a time
    const results: VerifyAcResult[] = [];
    const completedAcIds: string[] = [];
    // Part A — computed AT MOST ONCE per run (the binary's freshness doesn't vary
    // per-AC, same "resolve once, thread down" shape resolvedExecutionRoot/resolvedEnv
    // above use), and ONLY when some AC's command actually references the binary.
    let cachedBinaryFreshness: BinaryFreshnessVerdict | undefined;
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

      // SPEC-063 §Design Decisions D2 — spawns from the RESOLVED execution root,
      // not unconditionally `this.config.repoRoot` (the pre-SPEC-063 corpus-root
      // constant that silently mis-executed against the main checkout when the
      // caller was actually standing inside a linked worktree).
      const spawnSpec = buildVerifySpawnSpec(criterion, {
        repoRoot: resolvedExecutionRoot.root,
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
      let verifyResult: "pass" | "fail" | "inconclusive" = deriveVerifyResult(exitCode, timedOut);
      // Captured BEFORE either downgrade guard below may mutate `verifyResult` —
      // both Part A (freshness) and Part B/SPEC-061 (completeness) are
      // INDEPENDENT signals over the same "the process actually exited 0"
      // fact, so one downgrading `verifyResult` to "inconclusive" must never
      // suppress the other's own check (both are informative on the result;
      // see the combined-signal REGRESSION test in this file's sibling suite).
      const executedSuccessfully = verifyResult === "pass";

      // ③.4 build-freshness precheck (Part A, "verify trust extensions" task) —
      // applies to ANY oracle kind (not just "test") whose command spawns the
      // compiled binary; a command that doesn't reference it never even calls
      // the port.
      let binaryFreshness: BinaryFreshnessVerdict | undefined;
      if (executedSuccessfully && commandReferencesCompiledBinary(criterion.verify.command)) {
        if (cachedBinaryFreshness === undefined) {
          cachedBinaryFreshness = (
            this.checkBinaryFreshness ?? (() => this._computeRealBinaryFreshness())
          )();
        }
        binaryFreshness = cachedBinaryFreshness;
        if (binaryFreshness !== "fresh") {
          verifyResult = "inconclusive";
          warnings.push(
            `AC "${criterion.id}": dist/lore is ${binaryFreshness} — run 'bun run build' ` +
              "before trusting this attested result.",
          );
        }
      }

      // SPEC-061 §Scope D3 — attestation-completeness guard. Runs ONLY when the
      // process actually exited 0 (a nonzero exit/timeout is already "fail",
      // completeness is irrelevant to it — §Design; gated on `executedSuccessfully`,
      // NOT the possibly-already-downgraded `verifyResult`, so a Part-A freshness
      // downgrade never suppresses this independent check) AND ONLY for the "test"
      // oracle family (tsc/lint/build/e2e/other have different zero-work-green
      // modes and are explicitly OUT of this guard's scope). A zero/under-match
      // downgrades the recorded result to "inconclusive" — NEVER "pass" — so a
      // wrong test-path filter that silently matched fewer files than declared
      // can never masquerade as a real attested pass again (the AC-060-7
      // incident this guard closes). Part B extends this with a `-t`/
      // `--testNamePattern` matched-CASE check (`hasCaseFilter`) — a filterless
      // command's `judgeCompleteness` call is byte-identical to pre-Part-B.
      let completeness: CompletenessVerdict | undefined;
      let executedFiles: number | undefined;
      let declaredPaths: number | undefined;
      if (executedSuccessfully && criterion.verify.oracle === "test") {
        declaredPaths = countExplicitPathArgs(criterion.verify.command);
        const executedUnits = parseExecutedUnits(outputTail);
        completeness = judgeCompleteness({
          declaredPaths,
          executedUnits,
          hasCaseFilter: commandHasCaseFilter(criterion.verify.command),
        });
        if (executedUnits !== null) {
          executedFiles = executedUnits.files;
        }
        if (completeness === "zero_match" || completeness === "under_match") {
          verifyResult = "inconclusive";
        }
      }

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
            // SPEC-061 §Scope D4 — present-iff-computed (see field JSDoc on
            // evidenceEntrySchema.attestation).
            ...(completeness !== undefined ? { completeness } : {}),
            ...(executedFiles !== undefined ? { executed_files: executedFiles } : {}),
            // SPEC-063 §Design Decisions D3 — ALWAYS present on evidence recorded
            // under this change (both "corpus_root" and "worktree" resolutions),
            // so the audit trail can distinguish "recorded before SPEC-063" (both
            // fields absent) from "this run used the corpus root" (present, mode
            // "corpus_root").
            execution_root: resolvedExecutionRoot.root,
            execution_mode: resolvedExecutionRoot.mode,
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
        ...(completeness !== undefined ? { completeness } : {}),
        ...(executedFiles !== undefined ? { executed_files: executedFiles } : {}),
        ...(declaredPaths !== undefined ? { declared_paths: declaredPaths } : {}),
        ...(binaryFreshness !== undefined ? { binary_freshness: binaryFreshness } : {}),
      });
    }

    return ok({ task: { id: task.id, slug: task.slug }, results, skipped, warnings });
  }
}
