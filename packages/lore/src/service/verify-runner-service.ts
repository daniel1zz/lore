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
 *   ②.4 declared-scope selection + pre-flight refusal (`_selectDeclaredScopeCriteria`,
 *      pure; core `extractDeclaredAcScope` + `isAcInDeclaredScope`) — the resolved
 *      TASK's `extra.ac_scope` decides which declared criteria this run may touch:
 *      a default run selects `ac_scope ∩ declared criteria`, an out-of-scope `--ac`
 *      id refuses the WHOLE run, and an absent/empty/fully-dangling scope refuses
 *      too. Every refusal is `VALIDATION_ERROR` (exit 4, stderr) raised BEFORE any
 *      executor or `recordVerifiedEvidence` call — see that method's own table
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
 *   - `ai`/`human`-mode criteria in the (declared-scope- and optionally
 *     `acIds`-filtered) selection are never executed — they are reported in
 *     `result.skipped`, never silently dropped.
 *   - The target task's declared `ac_scope` is the ONLY thing that widens a default
 *     run's write scope (step ②.4). This service never infers a scope from the
 *     spec's full criteria list, and never from the task's existing evidence — the
 *     latter is the circular "audited evidence defines its own audit scope" defect
 *     `adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task` removes.
 *   - A run that would select ZERO criteria is a refusal, never an exit-0 no-op:
 *     an absent scope (with no `--ac`), an empty scope, and a scope matching no
 *     declared criterion all fail loud. A `skipped`-only outcome (an in-scope
 *     `ai`/`human` criterion) is NOT zero-selection and stays a success.
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
import type {
  Result,
  LoreError,
  AcceptanceCriterion,
  DocId,
  DocRecord,
  PlanBundle,
} from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  resolveTargetTask,
  extractDeclaredAcScope,
  isAcInDeclaredScope,
  resolveGoverningSpecByAcScope,
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

// ─── Pinned refusal literals (declared-scope contract) ─────────────────────

/**
 * The repair command every scope refusal names. PINNED by
 * `spec-declared-scope-attestation-contract-task-owned-ac-scope` §"Exit codes
 * and pinned message literals" (AC-VS-3 matches this exact substring), so it is
 * a named constant: reword the surrounding sentence freely, change THIS string
 * and a declared AC goes red by construction.
 */
const SCOPE_WRITER_HINT = "lore scope add";

/**
 * The EMPTY-`ac_scope` refusal's pinned literal (AC-VS-5). Contractually ABSENT
 * from the absent-scope message: "empty" (an author declared this task claims
 * nothing) and "absent" (nobody ever declared a scope) are two states, and the
 * two refusals must be distinguishable by a fixed string, not by wording taste.
 */
const EMPTY_SCOPE_LITERAL = "declares no acceptance criterion";

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
   * Step ②.4 — the declared-scope pre-flight: decides WHICH declared criteria
   * this run may touch, or REFUSES the whole run before any command executes.
   * Pure over its arguments (no IO, no state) — the only reason it is a method
   * rather than a free function is that its four refusals are part of this
   * service's contract surface.
   *
   * Three-valued by construction, reading the task's declaration through
   * `extractDeclaredAcScope` (`@lore/core`, which preserves absent-vs-empty):
   *
   * | declared `ac_scope` | `--ac` absent                     | `--ac` present                                    |
   * |---|---|---|
   * | ABSENT (`undefined`) | REFUSE, naming `lore scope add`  | run exactly the named ids (D2's stated escape)     |
   * | EMPTY (`[]`)         | REFUSE (`declares no acceptance criterion`) | REFUSE, same message — an un-declaration claims nothing, with or without a flag |
   * | POPULATED            | run `scope ∩ declared criteria`  | REFUSE if any named id is outside the scope, else run the named ids |
   *
   * A POPULATED scope whose ids match NO declared criterion is also refused: a
   * run selecting zero criteria would attest nothing while exiting 0, which is
   * the vacuous-pass shape this whole contract exists to remove. This is the
   * READ-side refusal `acScopeArraySchema`'s invariant (`phase.ts`) delegates
   * here — cross-entity membership is deliberately unchecked at the writer.
   * A scope that matches SOME criteria is fine: an `ai`/`human`-mode criterion
   * in scope is legitimately claimed and simply lands in `result.skipped`.
   *
   * @param criteria - every criterion declared on the parent spec (already
   *   `specAcceptanceCriteriaSchema`-parsed, non-empty)
   * @param task - the resolved target task, the SOLE owner of the declaration
   * @param specSlug - parent spec slug, for the dangling-scope diagnostic only
   * @param acIds - `opts.acIds`, already validated to name only declared ids
   * @returns the criteria this run may execute/record, or a `VALIDATION_ERROR`
   *   (CLI exit 4, stderr) whose message carries the pinned literal for its case
   */
  private _selectDeclaredScopeCriteria(
    criteria: AcceptanceCriterion[],
    task: DocRecord,
    specSlug: string,
    acIds: string[] | undefined,
  ): Result<AcceptanceCriterion[], LoreError> {
    const declared = extractDeclaredAcScope(task);
    const selectNamed = (ids: string[]): AcceptanceCriterion[] => {
      const idSet = new Set(ids);
      return criteria.filter((c) => idSet.has(c.id));
    };

    if (declared === undefined) {
      if (acIds !== undefined) return ok(selectNamed(acIds));
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `task "${task.slug}" has no declared ac_scope, so lore verify cannot know which ` +
          "acceptance criteria it claims — an unknown scope is never promoted to the spec's " +
          `full scope. Declare it with '${SCOPE_WRITER_HINT} ${task.slug} <AC-ID>' ` +
          "(repeatable), or name the criteria for this run explicitly with --ac <AC-ID>.",
        value: task.slug,
      });
    }

    if (declared.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `task "${task.slug}" ${EMPTY_SCOPE_LITERAL} — its ac_scope is an EMPTY array, an ` +
          "explicit un-declaration (a different state from an absent field), so there is " +
          `nothing for lore verify to attest. Re-declare with '${SCOPE_WRITER_HINT} ` +
          `${task.slug} <AC-ID>' before verifying.`,
        value: task.slug,
      });
    }

    if (acIds !== undefined) {
      const offending = acIds.filter((id) => !isAcInDeclaredScope(declared, id));
      if (offending.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acIds",
          message:
            `--ac named acceptance criterion id(s) outside task "${task.slug}"'s declared ` +
            `ac_scope: ${offending.join(", ")}. That task declares: ${declared.join(", ")}. ` +
            "lore verify never attests an AC the target task does not claim — widen the " +
            `declaration with '${SCOPE_WRITER_HINT} ${task.slug} ${offending.join(" ")}', or ` +
            "retarget the run with --task.",
          value: offending,
        });
      }
      return ok(selectNamed(acIds));
    }

    const inScope = criteria.filter((c) => isAcInDeclaredScope(declared, c.id));
    if (inScope.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `task "${task.slug}"'s declared ac_scope matches none of the acceptance criteria ` +
          `on spec "${specSlug}" — scope ids: ${declared.join(", ")}. A run selecting zero ` +
          "criteria would attest nothing while exiting 0, so it is refused: fix the scope " +
          `('${SCOPE_WRITER_HINT}' / 'lore scope rm') or the spec's acceptance_criteria.`,
        value: declared,
      });
    }
    return ok(inScope);
  }

  /**
   * Shared execution+recording tail (steps ③④) for BOTH `verifyPlan` (plan-owned
   * tasks, resolved via `getPlanBundle` + claim-based `resolveTargetTask`) and
   * {@link verifyAdhocTask} (SPEC-069 ad-hoc tasks — task-the-ad-hoc-task-channel-
   * has-no-attested-evidence-path-lore — resolved via an explicit task + a
   * searched-for governing spec). Extracted so the two entry points, which reach
   * `{task, spec, selectedCriteria}` through completely different resolution
   * paths, share IDENTICAL execution semantics: the M2 command-provenance
   * approval gate, the execution-root/env resolution, the build-freshness and
   * SPEC-061 completeness guards, and the sole `recordVerifiedEvidence`
   * attestation write. Neither caller may skip or reorder any of this — see the
   * class-level JSDoc's four-step pipeline. Behavior-preserving extraction: this
   * method's body is `verifyPlan`'s pre-existing step-③④ code, unchanged
   * (REGRESSION — `verify-runner-service.test.ts`'s pre-existing suite exercises
   * this exact logic through `verifyPlan` and passes unmodified).
   *
   * @param selectedCriteria - Already `_selectDeclaredScopeCriteria`-filtered
   *   criteria (both callers run that same pre-flight before reaching here).
   * @param task - The resolved target task evidence is recorded against.
   * @param spec - The resolved governing spec (consulted for the draft/active
   *   advisory only — no other field of it is read here).
   * @param opts - Same `VerifyPlanOpts` the public entry points receive.
   * @param recordAcRef - `true` for BOTH `verifyPlan` (plan-owned tasks) AND
   *   {@link verifyAdhocTask} (SPEC-069 ad-hoc tasks, AC-069-15,
   *   task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested) — every
   *   runner-attested evidence entry this method writes carries `ac_ref` equal
   *   to the executed criterion's id. Kept as an explicit caller-supplied
   *   boolean (not hardcoded `true` inline) so this shared tail's contract is
   *   spelled out at both call sites, not assumed. HISTORICAL (measured
   *   2026-08-01, fixed by task-an-ad-hoc-task-s-attested-evidence-cannot-carry-
   *   ac-ref): `TaskWorkflowService.appendEvidenceEntry` (the shared
   *   implementation behind the injected `recordVerifiedEvidence` port) used to
   *   cross-validate any supplied `ac_ref` by calling
   *   `resolveDeclaredAcIds(task.parent_id)` UNCONDITIONALLY — which
   *   hard-requires `task.parent_id` to resolve to a `type: "plan"` document. An
   *   ad-hoc task's `parent_id` is the corpus root PRD, so that call refused
   *   `Expected a plan document; got type 'prd'` for EVERY ad-hoc task, one layer
   *   DEEPER than `VerifyRunnerService` itself — which is why `verifyAdhocTask`
   *   used to pass `recordAcRef: false` here. `appendEvidenceEntry` now BRANCHES
   *   on `task.extra.adhoc` — an ad-hoc task's `ac_ref` resolves via the injected
   *   `resolveAdhocGoverningAcIds` port (`CorpusService.resolveDeclaredAcIdsForAdhocTask`,
   *   which runs the SAME `resolveGoverningSpecByAcScope` search this class's own
   *   `verifyAdhocTask` runs, `@lore/core`) instead of the plan-only walk — so
   *   supplying `ac_ref` from THIS method for an ad-hoc task now succeeds, and
   *   an undeclared criterion id is refused (AC-069-16 — no new bypass) exactly
   *   as the plan-owned path already was.
   */
  private async _runVerification(
    selectedCriteria: AcceptanceCriterion[],
    task: DocRecord,
    spec: DocRecord,
    opts: VerifyPlanOpts,
    recordAcRef: boolean,
  ): Promise<Result<VerifyPlanResult, LoreError>> {
    const scriptCriteria: ScriptAcceptanceCriterion[] = [];
    const skipped: VerifySkippedAc[] = [];
    for (const criterion of selectedCriteria) {
      if (criterion.verify.mode === "script") {
        scriptCriteria.push(criterion as ScriptAcceptanceCriterion);
      } else {
        skipped.push({ ac_id: criterion.id, mode: criterion.verify.mode });
      }
    }

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
      // reason: `acRef` is gated on the SAME `recordAcRef` flag the `ac_ref` evidence
      // field below is (spec-evidence-output-tail-integrity-a-self-reported-non-pass
      // §D4) — the runner should only prefer an AC-witnessing output_tail window when
      // the resulting row will actually carry that ac_ref, keeping the two in lockstep
      // rather than letting the tail witness an id the row itself doesn't declare.
      const spawnSpec = buildVerifySpawnSpec(criterion, {
        repoRoot: resolvedExecutionRoot.root,
        defaultTimeoutMs: this.config.defaultTimeoutMs,
        ...(resolvedEnv !== undefined ? { env: resolvedEnv } : {}),
        ...(recordAcRef ? { acRef: criterion.id } : {}),
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
          // reason: task-capture-source-is-optional-at-the-evidence-write-boundary
          // AC-3 — this service SPAWNS `criterion.verify.command` itself (step ③,
          // `executor`), so "runner" is the value this call site can actually PROVE,
          // not merely the value `appendEvidenceEntry` would force from `attestation`
          // being present a few lines below. Passing it explicitly documents the
          // caller's own provenance claim rather than leaning on that downstream
          // override, and satisfies `VerifiedEvidenceInput`'s compile-time-required
          // field either way.
          capture_source: "runner",
          // reason: see this method's `recordAcRef` param JSDoc — both call
          // sites (verifyPlan, verifyAdhocTask) now pass `true` (AC-069-15), so
          // every runner-attested entry carries `ac_ref` equal to the executed
          // criterion's id, cross-validated by `appendEvidenceEntry` through
          // either the plan-owned `parent_id` walk or (for an ad-hoc task) the
          // injected `resolveAdhocGoverningAcIds` port — an id it can't resolve
          // there is refused (AC-069-16), which this method surfaces verbatim
          // via the `recordResult.ok` check below (no bypass).
          ...(recordAcRef ? { ac_ref: criterion.id } : {}),
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

  /**
   * SPEC-069 ad-hoc-task runner path (task-the-ad-hoc-task-channel-has-no-
   * attested-evidence-path-lore) — `lore verify --task <adhoc-task>` with NO
   * PLAN positional. An ad-hoc task (`extra.adhoc === true`, SPEC-069 §Design
   * Decisions D2) has no `plan_id` and is parented to the corpus root PRD, so
   * `getPlanBundle` structurally cannot resolve a governing spec for it — this
   * method takes the ALREADY-RESOLVED task and the full candidate spec list as
   * plain data instead (both fetched by the CLI adapter via `app.corpusService`,
   * mirroring this class's existing "adapter resolves IO, service decides"
   * split for `getPlanBundle` itself — no NEW constructor port is needed).
   *
   * Governing-spec resolution (measured 2026-08-01: no structural plan/spec
   * link exists for an ad-hoc task — a real corpus task implementing an AC on a
   * named spec, `task-ac-ll-8-guards-the-loader-strip-not-the-no-sync-bearing`,
   * carries NO `ac_scope` and NO link to that spec; the association exists only
   * in prose). The task's declared `extra.ac_scope` must name AC ids that are
   * declared, IN FULL, on EXACTLY ONE candidate spec's `acceptance_criteria` —
   * zero or multiple matching specs REFUSE loud (`VALIDATION_ERROR`). This
   * method never guesses which spec governs an ad-hoc task: `AC-*` ids are
   * unique only WITHIN one spec's declared criteria (`specAcceptanceCriteriaSchema`),
   * never enforced globally, so guessing wrong would silently attest a real
   * script command against the wrong spec's acceptance criteria. The actual
   * search (zero/multi-match refusal included) is `resolveGoverningSpecByAcScope`
   * (`@lore/core`) — shared verbatim with `CorpusService.resolveDeclaredAcIdsForAdhocTask`
   * (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref) so the two
   * surfaces can never disagree about which spec governs a given ad-hoc task.
   *
   * Every step AFTER spec resolution (declared-scope selection, M2 approval
   * gate, execution, freshness/completeness guards, attested evidence write) is
   * the IDENTICAL shared tail `verifyPlan` uses ({@link _runVerification},
   * `recordAcRef: true` here — see that param's own JSDoc) — an ad-hoc task's
   * runner-attested evidence is now SHAPE-IDENTICAL to a plan-owned task's: it
   * carries a REAL `attestation.runner: "lore-cli"` / `exit_code` / `duration_ms`
   * from an ACTUAL executed command (never a synthesized marker) AND `ac_ref`
   * equal to the executed criterion's id (AC-069-15,
   * task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested — the LAST
   * remaining shape difference between the two channels, now retired).
   *
   * HISTORICAL (measured 2026-08-01): `ac_ref` used to be that one remaining
   * difference, because `TaskWorkflowService.appendEvidenceEntry`'s cross-entity
   * validation for an ad-hoc task called `resolveDeclaredAcIds(task.parent_id)`
   * UNCONDITIONALLY — which hard-requires `task.parent_id` to resolve to a
   * `type: "plan"` document, structurally impossible for an ad-hoc task (its
   * parent is the root PRD). `task-an-ad-hoc-task-s-attested-evidence-cannot-
   * carry-ac-ref` fixed that: `appendEvidenceEntry` now resolves an ad-hoc
   * task's `ac_ref` via the injected `resolveAdhocGoverningAcIds` port →
   * `CorpusService.resolveDeclaredAcIdsForAdhocTask` → this SAME
   * `resolveGoverningSpecByAcScope` search — so supplying `ac_ref` from this
   * method is cross-validated the same way a plan-owned task's is, and a
   * criterion id the resolved governing spec does not declare is still refused
   * (AC-069-16 — no new bypass): that refusal surfaces as a `recordVerifiedEvidence`
   * `Result` failure, which this method's shared `_runVerification` tail
   * propagates verbatim (same abort semantics as any other write failure —
   * never silently swallowed).
   *
   * @param task - The resolved target task (caller MUST have already resolved
   *   this by id/slug; this method does no id resolution of its own).
   * @param candidateSpecs - Every `spec`-typed doc in the corpus (caller-fetched,
   *   e.g. `corpusService.listFull({type: "spec"}).docs`) — filtered here down
   *   to the ones that fully declare the task's ac_scope.
   * @param opts - Same `VerifyPlanOpts` `verifyPlan` accepts.
   * @returns Same `VerifyPlanResult` contract as `verifyPlan`.
   * @throws (as `Result`) VALIDATION_ERROR — `task` is not type "task"; task is
   *   not ad-hoc (`extra.adhoc !== true`); ac_scope absent/empty; ac_scope
   *   matches zero or more than one candidate spec; unknown `--ac` id (SAME
   *   message shape `verifyPlan` uses); any of `_selectDeclaredScopeCriteria`'s
   *   four refusals — plus everything `_runVerification` can throw.
   */
  async verifyAdhocTask(
    task: DocRecord,
    candidateSpecs: DocRecord[],
    opts: VerifyPlanOpts,
  ): Promise<Result<VerifyPlanResult, LoreError>> {
    if (task.type !== "task") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message:
          `Expected a task document for the ad-hoc verify path; got type '${task.type}'. ` +
          "The no-PLAN-positional invocation targets a SPEC-069 --adhoc TASK only.",
        value: task.type,
      });
    }
    if (task.extra["adhoc"] !== true) {
      return err({
        code: "VALIDATION_ERROR",
        field: "adhoc",
        message:
          `task "${task.slug}" is not ad-hoc (extra.adhoc !== true) — the no-PLAN-positional ` +
          "lore verify path is reachable ONLY for a SPEC-069 --adhoc task. Pass the PLAN " +
          "positional (this task's plan_id) to verify a plan-owned task.",
        value: task.slug,
      });
    }

    const declared = extractDeclaredAcScope(task);
    if (declared === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `ad-hoc task "${task.slug}" has no declared ac_scope, so lore verify cannot resolve ` +
          "a governing spec for it (no plan/spec link exists for an --adhoc task, SPEC-069 " +
          `D2) — declare one with '${SCOPE_WRITER_HINT} ${task.slug} <AC-ID>' first.`,
        value: task.slug,
      });
    }
    if (declared.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `ad-hoc task "${task.slug}" ${EMPTY_SCOPE_LITERAL} — its ac_scope is an EMPTY array, ` +
          "so there is no declared AC id to resolve a governing spec from. Re-declare with " +
          `'${SCOPE_WRITER_HINT} ${task.slug} <AC-ID>' before verifying.`,
        value: task.slug,
      });
    }

    // Shared search (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref)
    // — SAME function `CorpusService.resolveDeclaredAcIdsForAdhocTask` calls, so
    // the two surfaces can never disagree about which spec governs this task.
    const resolveResult = resolveGoverningSpecByAcScope(
      declared,
      candidateSpecs,
      `ad-hoc task "${task.slug}"`,
    );
    if (!resolveResult.ok) return resolveResult;
    const { spec, criteria } = resolveResult.value;

    // Mirrors verifyPlan's pre-existing unknown-acIds check (SAME field/message
    // shape) — a caller-named --ac id must be declared on the RESOLVED spec.
    if (opts.acIds !== undefined) {
      const declaredIds = new Set(criteria.map((c) => c.id));
      const unknown = opts.acIds.filter((id) => !declaredIds.has(id));
      if (unknown.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acIds",
          message: `unknown AC id(s) not declared on spec "${spec.slug}": ${unknown.join(", ")}`,
          value: unknown,
        });
      }
    }

    const selectionResult = this._selectDeclaredScopeCriteria(criteria, task, spec.slug, opts.acIds);
    if (!selectionResult.ok) return selectionResult;

    // recordAcRef: true (AC-069-15) — see _runVerification's own param JSDoc
    // for the historical reason this used to be false and why supplying
    // ac_ref here is now cross-validated safely.
    return this._runVerification(selectionResult.value, task, spec, opts, true);
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
   *   structured acceptance_criteria / unknown acIds / target-task ambiguity / any
   *   of step ②.4's four declared-scope refusals — absent, empty, out-of-scope
   *   `--ac`, fully-dangling scope),
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

    // The pre-existing unknown-AC-id check stays HERE, ahead of target-task
    // resolution: an id no spec criterion declares is a caller error regardless
    // of which task the run would target (REGRESSION-pinned — the refusal names
    // field "acIds" and fires even for an ambiguous target).
    if (opts.acIds !== undefined) {
      const declaredIds = new Set(criteriaParsed.data.map((c) => c.id));
      const unknown = opts.acIds.filter((id) => !declaredIds.has(id));
      if (unknown.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acIds",
          message: `unknown AC id(s) not declared on spec "${spec.slug}": ${unknown.join(", ")}`,
          value: unknown,
        });
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

    // ②.4 declared-scope selection + pre-flight refusal — MUST run after ② (the
    // declaration lives on the resolved task) and BEFORE anything in step ③,
    // so a refusal leaves zero executions and zero recorded entries.
    const selectionResult = this._selectDeclaredScopeCriteria(
      criteriaParsed.data,
      task,
      spec.slug,
      opts.acIds,
    );
    if (!selectionResult.ok) return selectionResult;

    // recordAcRef: true — BYTE-IDENTICAL to pre-SPEC-069 behavior (REGRESSION).
    return this._runVerification(selectionResult.value, task, spec, opts, true);
  }
}
