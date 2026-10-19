/**
 * AcService — manages structured acceptance criteria declared on spec documents.
 *
 * Acceptance criteria live in `spec.extra.acceptance_criteria` (array of
 * `AcceptanceCriterion`, schema-validated by `specAcceptanceCriteriaSchema` —
 * `@lore/core` acceptance.ts). They are NOT a doc type — no id of their own beyond
 * the `AC-*` string `id` field and no lifecycle of their own; changes ride the parent
 * spec's own version log, because AC declarations are judge-consumed data
 * (SPEC-026/038) and history is what makes a retired oracle auditable.
 *
 * ⛔ RECORD LOCK (spec-documents-are-living-or-records-a-locked-record-is-never D6/D12, BR-1048):
 * `addCriterion`, `removeCriterion` and `setCriterion` are REFUSED (`VALIDATION_ERROR`,
 * `field: "gate:record-edit"`, exit 4) on a spec that has ever been approved — an added, removed or
 * edited criterion changes what was accepted, so it belongs to a new spec. `citeCriterion` is NOT
 * a rewrite and stays open. EXCEPTION (BR-1069): `setCriterion` with `opts.correction` fixes ONE existing
 * criterion of a locked spec as an audited correction (one version, status kept, reason in change_summary and
 * the audit row); `addCriterion` / `removeCriterion` have no such exit. The check is `RecordLockService.assertEditable(spec, "criteria")`,
 * run BEFORE any validation or write; `RecordLockService` is a REQUIRED constructor argument so a
 * service composed without it does not compile (D17). This REVERSES the older shape
 * "`lore ac add` logs a version and does not demote": on a locked spec it now refuses.
 *
 * The approved->draft demotion (D2 below) therefore only serves a spec the lock does not cover —
 * in practice a spec whose `record-edit` gate is switched off by
 * `workflow.gates."record-edit".enabled: false` (BR-1053). `PhaseService`'s three phase-set
 * writers log a version row and never demote — see
 * `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan` — and are gated the same way on a
 * closed plan (D16).
 *
 * Public surface:
 *   addCriterion(specIdOrSlug, criterion)          → AcceptanceCriterion[] (updated list)
 *   listCriteria(specIdOrSlug)                     → AcListResult { criteria, coverage, dangling }
 *   removeCriterion(specIdOrSlug, acId, opts?)     → AcceptanceCriterion[] (updated list)
 *   setCriterion(specIdOrSlug, acId, patch)        → AcceptanceCriterion[] (updated list) —
 *     in-place edit of ONE declared criterion (spec-lore-ac-set-in-place-edit-of-a-declared-
 *     acceptance, D1-D6). `id`/`mode` are immutable; `statement`/`covers` are mode-agnostic;
 *     `oracle`/`command`/`falsifier` (script) / `rubric` (ai) / `note` (human) are mode-specific
 *     and rejected as VALIDATION_ERROR when passed against a criterion of a different mode (D5).
 *     `falsifier` (task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error) REPLACES the
 *     whole `verify.falsifier` object — see {@link SetCriterionPatch.falsifier}'s own JSDoc for
 *     the require-all-four-together partial-update contract.
 *
 * @invariant `setCriterion` bumps the criterion's `oracle_generation` EXACTLY WHEN the
 *   resulting script-mode `verify.command` differs from the stored one (spec-the-defect-
 *   channel-cannot-be-honestly-maintained-an §M5, AC-DC-8) — a rewritten oracle is a NEW
 *   GENERATION, so `computeAcCoverage` can report evidence recorded against the retired
 *   command as prior-generation. Monotonic, never reused, never reset; every other edit
 *   (statement-only, `--covers`, `--falsifier-*`, an identical re-set, any non-script
 *   criterion) carries the stored value through untouched — including ABSENT, so such a
 *   write stays byte-identical to pre-M5 behavior. ⛔ This method writes ONLY the SPEC
 *   doc: not one stored evidence row is edited, deleted, or hidden by the bump —
 *   supersession is additive metadata on the criterion, matching the append-only
 *   invariant the evidence log rests on. Decision table:
 *   {@link resolveNextOracleGeneration}.
 * @invariant All methods return Promise<Result<T, LoreError>> — no thrown exceptions.
 * @invariant `addCriterion` validates the FULL candidate array (existing + new) via
 *   `specAcceptanceCriteriaSchema` in one `safeParse` call — covers the new entry's own
 *   shape (id format, verify discriminant) AND array-level constraints (max 50, unique
 *   id) simultaneously. Mirrors `CorpusService.set`'s single-shot spec-extra validation
 *   (schemas.ts's `spec_kind` superRefine precedent) rather than re-deriving per-field
 *   checks here.
 * @invariant `addCriterion` ALSO rejects an unquantified abstract-quality claim in the
 *   new entry's `statement` (AC-Quantifiability Gate spec §Design) — the deterministic,
 *   zero-LLM `lintAcQuantifiability` lint (`@lore/core`, ac-quality.ts) runs AFTER shape
 *   validation succeeds and BEFORE the CAS write, so a `lore ac add` with an
 *   unquantified AC never reaches the store. This is the immediate-feedback layer; the
 *   `acQuantifiable` gate predicate (`gate-predicates.ts`, wired into `spec-create`/
 *   `spec-promote`) is the backstop for ACs added through any other path.
 * @invariant `removeCriterion` fails loud (VALIDATION_ERROR) when any task under a
 *   child plan of the spec has `verification_evidence[].ac_ref === acId`, UNLESS
 *   `opts.force` is true. A forced removal never touches task evidence — those
 *   `ac_ref` values become "dangling" (surfaced by `listCriteria`'s `dangling[]`,
 *   SPEC-038 §9 STATE dimension) rather than silently cleaned up. NOT (yet) extended
 *   to ad-hoc-governed tasks (see the next invariant) — a NAMED follow-up gap, since
 *   this method's own safety check is currently scoped to child-plan tasks only.
 * @invariant `listCriteria`'s coverage additionally folds in `--adhoc` tasks whose
 *   declared `ac_scope` resolves UNAMBIGUOUSLY to this spec (task-an-ad-hoc-task-s-
 *   attested-evidence-cannot-carry-ac-ref) — `findAdhocGovernedTasks` reuses the SAME
 *   `resolveGoverningSpecByAcScope` search (`@lore/core`) `VerifyRunnerService.
 *   verifyAdhocTask`/`CorpusService.resolveDeclaredAcIdsForAdhocTask` run, never a
 *   bare string match on `ac_ref` (AC ids are unique only WITHIN one spec, never
 *   globally — a coincidental cross-spec id collision must not double-count).
 * @invariant Writes are CAS-guarded (`store.update`'s `expected_version`) and produce
 *   exactly one `insertVersion` snapshot + one `appendAuditEntry` (action "update",
 *   actor = the calling `opts.by`, else the session/OS-user chain — never "system") — same shape as `CorpusService.set`'s spec-extra write path, so
 *   `AuditService.verify`'s versions⋈audit completeness oracle (SPEC-035 §2) is
 *   satisfied without a special case for AC writes.
 * @invariant `setCriterion` applies the SAME approved→draft demotion rule
 *   `CorpusService.set` applies to a content/title edit — an in-place AC edit changes
 *   the spec's governing contract exactly as much as a content edit does (D2). "The
 *   same rule" is literal, not asserted by comment: both services call the ONE
 *   implementation, `resolveStatusAfterContractEdit` in `@lore/core` (schemas.ts,
 *   beside `VALID_TRANSITIONS`). It lives there because neither service may own it —
 *   `AcService` importing from `CorpusService` would trade an SSOT violation for the
 *   module invariant "service per concern, no cross-service imports" (module
 *   CLAUDE.md), while `@lore/core` is a dependency both already have and creates no
 *   cross-service edge. This method passes `contentChanged: true` explicitly: an AC
 *   edit is ALWAYS a contract change (an empty patch already returned
 *   VALIDATION_ERROR before the write). It was MIRRORED here until 2026-08-01
 *   (task-the-approved-to-draft-demotion-rule-is-mirrored-in-ac) — the two copies were
 *   held together by cross-referencing comments only, which is a prose mitigation for a
 *   mechanism problem; `tests/unit/service/demotion-rule-ssot.test.ts` is now the
 *   mechanism (it stubs the shared function and fails if either call site drifts).
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-038 §4, §6, §7 D4; spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D1-D6
 */

import { err, ok, type Result } from "@lore/core";
import { resolveWriteActorFor } from "../store/write-context-store.js";
import type { LoreError } from "@lore/core";
import {
  specAcceptanceCriteriaSchema,
  computeAcCoverage,
  extractEvidence,
  lintAcQuantifiability,
  resolveStatusAfterContractEdit,
  resolveOracleGeneration,
  findMissingOracleFiles,
  findUncheckedOracleSegments,
  evidenceRanMissingOracle,
  type AcceptanceCriterion,
  type AcCoverageFact,
  type AcVerifyMode,
  type FileExistsPort,
} from "@lore/core";
import type { AuditEntry, DocId, DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { findSpecChildPlans, findSpecEvidenceTasks, findTasksUnderPlans } from "./spec-evidence-tasks.js";
import { resolveDoc } from "./resolve.js";
import type { RecordLockService } from "./record-lock-service.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
import { buildRuleIndex, citeWarnings, type CiteWarning } from "./ac-citations.js";
import { ownProposedRules } from "./rule-changes.js";
import { admitAcWrite, applyAcChange, decorateCiteRefusal, pipeAdvisories, resolveCiteGateFor } from "./ac-write-chokepoint.js";
import type { CiteGateConfig } from "./ac-cite-gate.js";
import { CorpusWriteAuthority, type CorpusWriteAuthorityContext } from "./foreign-corpus-write-guard.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** Result of {@link AcService.listCriteria}. */
export interface AcListResult {
  /** Declared acceptance criteria, in declaration order. */
  criteria: AcceptanceCriterion[];
  /**
   * Pass/fail coverage facts, one per declared criterion — present iff the spec has
   * at least one child plan (regardless of whether that plan has any tasks yet) OR
   * at least one `--adhoc` task whose declared `ac_scope` resolves UNAMBIGUOUSLY to
   * this spec (task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref — an
   * ad-hoc task has no structural plan/spec link, SPEC-069 D2, so its evidence is
   * folded in via `resolveGoverningSpecByAcScope`, never a child-plan walk).
   * `null` means "nothing to aggregate against", NOT "zero coverage" — a spec with a
   * plan that has zero tasks (or an ad-hoc match with zero evidence) yields
   * `[]`-shaped facts (0 pass, 0 fail), not `null`.
   */
  coverage: AcCoverageFact[] | null;
  /**
   * `ac_ref` values found in child-plan tasks' evidence that do not match any
   * currently-declared criterion id — the residue of a `removeCriterion(..., {force:
   * true})` call whose evidence was deliberately left untouched. Sorted, deduplicated.
   */
  dangling: string[];
  /**
   * The spec's live `--allow-missing-path` (red-first) declarations, `{ac_id, reason}`, independent of `coverage`
   * (which is `null` for a spec with no plan/task yet). Read by `scripts/check-ac-oracle-ownership.ts`.
   * Optional: list renderers that build an `AcListResult` by hand omit it.
   */
  allow_missing_declarations?: { ac_id: string; reason: string }[];
}

/** Options for {@link AcService.removeCriterion}. */
export interface RemoveCriterionOpts {
  /** Remove even when task evidence still references this id (see class invariant). */
  force?: boolean;
  /** The calling actor — see {@link DeclarePathOpts.by}. */
  by?: string;
}

/**
 * Patch for {@link AcService.setCriterion} — every field optional, each one present
 * REPLACES that field on the target criterion, each one absent leaves it untouched
 * (D1). Deliberately has no `id`/`mode` field — those two are NOT editable through
 * this verb (D1): a caller wanting to change `mode` must use `rm` + `add` instead,
 * which this type cannot even represent, making the immutability structural rather
 * than a runtime check alone.
 *
 * @invariant `statement` and `covers` are mode-agnostic — every criterion has a
 *   statement, and any criterion may declare covered PRD requirement ids.
 * @invariant `oracle`/`command`/`falsifier` apply only to a `mode: "script"`
 *   criterion, `rubric` only to `"ai"`, `note` only to `"human"` — passing one
 *   against a criterion of a different mode is VALIDATION_ERROR (D5), never
 *   silently accepted-and-dropped.
 * @invariant `covers`, when present, REPLACES `requirement_refs` wholesale — an
 *   empty array (`[]`) clears it. `undefined` (the field omitted) leaves the
 *   existing `requirement_refs` untouched. The caller (CLI `commands/ac.ts`) is
 *   responsible for turning a bare `--covers ""` into `[]` before calling here.
 * @invariant `falsifier` — **REQUIRE-ALL-FOUR-TOGETHER partial-update contract**
 *   (task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error): when present,
 *   it REPLACES the criterion's ENTIRE `verify.falsifier` object; `undefined` (no
 *   `--falsifier-*` flag passed at all) leaves any existing falsifier untouched.
 *   There is NO field-level merge onto a previously-stored falsifier — a caller
 *   supplying only SOME of the four `--falsifier-*` flags produces a PARTIAL
 *   candidate object here (assembled by the CLI's `buildFalsifierCandidate`,
 *   shared with `add`), which then fails `specAcceptanceCriteriaSchema`'s
 *   `acFalsifierSchema` (`@lore/core`) naming the missing field(s) — the SAME
 *   all-four-or-fail-loud shape `add` already documents on itself. This was a
 *   deliberate choice between two defensible options (either is fine; an
 *   UNDOCUMENTED half-write is not, per this task's own mandate): a field-level
 *   merge would let a caller change ONLY `expected_exit_code` while silently
 *   keeping a now-stale `find`/`replace` pair pointed at content that may no
 *   longer exist — exactly the kind of half-write CLAUDE.md's "governance `set`
 *   commands... silently swallow" standing rule warns about. Requiring all four
 *   together makes every `set`-edited falsifier as fully re-declared, and
 *   therefore as trustworthy, as one created via `add` — never a blend of new
 *   and stale values a reader would have to reconstruct by hand.
 */
export interface SetCriterionPatch {
  statement?: string;
  oracle?: string;
  command?: string;
  /** Script mode only: positive-integer `verify.timeout_ms`; `null` REMOVES the field. */
  timeout_ms?: number | null;
  rubric?: string;
  note?: string;
  covers?: string[];
  /**
   * Baseline rule ids this criterion cites — REPLACES the whole list (`[]` clears it).
   * Report-only: dangling / inactive ids are stored and surfaced as audit-recorded warnings
   * (baseline slice 1 §C4). Grammar/uniqueness/cap are the schema's (`cites`).
   */
  cites?: string[];
  /**
   * Untyped candidate `AcFalsifier` shape — same rationale as `buildCriterionCandidate`'s
   * `verify` field in `commands/ac.ts`: `specAcceptanceCriteriaSchema` (via `acFalsifierSchema`)
   * is the single source of truth for whether all four sub-fields (`path`/`find`/`replace`/
   * `expected_exit_code`) are present and well-formed. This field only carries the shaped
   * candidate through; it is never itself validated here.
   */
  falsifier?: unknown;
}

// ─── D8 Declaration-Time Path-Existence Check ──────────────────────────────
// (task-promote-the-oracle-file-existence-primitives-into-lore,
//  spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.3/D8)

/**
 * Injected filesystem context for {@link AcService.addCriterion}/
 * {@link AcService.setCriterion}'s D8 declaration-time path-existence check,
 * and for {@link AcService.countUnredeemedAllowMissingPath}'s corpus-wide
 * count. Mirrors `DriftCheckService`'s `FsProbe`/`anchor-resolution.ts`'s
 * per-CALL injection shape (never a constructor default): the check is a
 * complete no-op whenever a caller omits it, so every pre-existing 2/3-arg
 * `addCriterion`/`setCriterion` call site across the repo (CLI `commands/
 * ac.ts`, every other test file) keeps compiling and behaving byte-
 * identically until a CLI/MCP surface is wired to pass a real one.
 */
export interface OraclePathContext {
  /** Real caller: `fs.existsSync`; tests inject a fake — never a real filesystem read here. */
  fileExists: FileExistsPort;
  /** Absolute current working directory the declared command's path token(s) resolve against. */
  cwd: string;
  /** Absolute discovered `.lore/` corpus root, when distinct from `cwd`. */
  corpusRoot?: string;
}

/**
 * Options for {@link AcService.addCriterion}/{@link AcService.setCriterion}'s
 * D8 declaration-time path-existence check.
 *
 * @invariant The check runs ONLY when `pathContext` is supplied — see
 *   {@link OraclePathContext}'s own doc for why this is opt-in rather than a
 *   service-owned default.
 * @invariant `allowMissingPath` is the D8 escape: a non-empty reason unlocks
 *   a script-mode command naming a test-file path not yet on disk (a
 *   red-first AC legitimately names a test not yet written —
 *   `~/.claude/skills/shared/verification-discipline.md`'s mandatory
 *   red-first discipline). An empty/whitespace-only/absent reason is
 *   REFUSED whenever a missing path was actually found — "refuse by
 *   default, with ONE explicit, audited escape" (D8). Supplying it when NO
 *   path is missing is harmless: nothing is declared (there is nothing to
 *   redeem).
 */
export interface DeclarePathOpts {
  pathContext?: OraclePathContext;
  allowMissingPath?: string;
  /**
   * The calling actor (CLI: the invoking identity; MCP/HTTP: their own resolution),
   * written as the version row's `created_by` and the audit row's `actor`. Omitted only by bare
   * service constructions (unit tests, internal callers) — the actor then resolves through the
   * env chain (session tier → OS username), exactly as `CorpusService` does.
   * Source: spec-baseline-slice-2 §C3 (actor provenance on AC writes).
   */
  by?: string;
  /**
   * Receives each non-blocking advisory of a SUCCESSFUL write, one call per note (BR-1078: an unsafe pipe in an
   * oracle-`other` command, stored as written). The CLI prints each on stderr; omitted → advisories are dropped.
   * Never called for a refused write.
   */
  onAdvisory?: (advisory: string) => void;
}

/**
 * Options for {@link AcService.setCriterion}: the D8 path options plus the audited correction exit.
 * A SEPARATE type so `addCriterion` / `removeCriterion` (which keep {@link DeclarePathOpts}) can never
 * receive a correction (spec-a-criterion-of-a-locked-specification-can-be-fixed-as-an D4, BR-1069).
 */
export interface SetCriterionOpts extends DeclarePathOpts {
  /** Audited fix of this one criterion: skips ONLY the record-edit gate and the approved→draft demotion (D2). */
  readonly correction?: { readonly reason: string };
}

/**
 * One tracked D8 escape-hatch exercise — an AC whose declaration named a
 * script-mode command path that did not exist on disk AT DECLARATION TIME,
 * with the reason the caller supplied. Stored in
 * `spec.extra.allow_missing_path_declarations` (a key `acceptance.ts`'s
 * `specAcceptanceCriteriaSchema` never validates or strips — deliberately
 * NOT a field on the criterion's own `verify` object, which WOULD be
 * silently stripped by that schema's default "strip unknown keys" `z.object`
 * behavior).
 *
 * @invariant Whether a given declaration is currently UNREDEEMED is NEVER
 *   cached here — it is recomputed fresh from the live filesystem every time
 *   {@link AcService.countUnredeemedAllowMissingPath} runs, by re-extracting
 *   the OWNING criterion's current `command` and re-checking it. A cached
 *   boolean would make the escape an untracked silent fallback the moment it
 *   went stale — the exact defect D8 exists to prevent.
 */
export interface AllowMissingPathDeclaration {
  ac_id: string;
  reason: string;
  declared_at: string;
}

// ─── AcService ─────────────────────────────────────────────────────────────

/**
 * Constructor options of {@link AcService}. PRESENCE of this object arms the citation gate
 * (spec-baseline-slice-2 §C4); a bare `new AcService(store)` is ungated and byte-identical to before —
 * the same optional-DI shape `GateEnforcer` has for the services it guards.
 */
export interface AcServiceOptions {
  /**
   * The raw, untrusted `workflow.gates."ac-cite"` entry (`resolveCiteGateRaw`, `@lore/core`);
   * `undefined` = not configured, which resolves to `off` without baseline docs and `report` with them.
   */
  citeGate?: unknown;
}

export class AcService {
  /** Present iff the gate is armed (constructed with {@link AcServiceOptions}); `raw` is validated per write. */
  private readonly citeGate: { raw: unknown } | undefined;

  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   * @param options - citation-gate wiring; omit for an ungated service (bare unit tests)
   */
  constructor(
    private readonly store: StoreInterface,
    /**
     * REQUIRED (spec-documents-are-living-or-records D17): add/set/remove ask this before they write.
     * Never optional — an unwired service must fail to construct.
     */
    private readonly recordLock: RecordLockService,
    options?: AcServiceOptions,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer sharing this service's record lock. This service never calls a store write primitive itself.
    writer?: DocWritePort,
  ) {
    this.citeGate = options === undefined ? undefined : { raw: options.citeGate };
    this.writer = writer ?? bareDocWriter(store, recordLock);
  }

  private readonly writer: DocWritePort;

  /**
   * The citation gate's resolved configuration as THIS service applies it. A bare (ungated) service
   * reports `off`. An invalid configured mode is `ok: false` (VALIDATION_ERROR) — never a default.
   */
  async resolveCiteGate(): Promise<Result<CiteGateConfig, LoreError>> {
    if (this.citeGate === undefined) return ok({ mode: "off", armed_branches: [] });
    return resolveCiteGateFor(this.store, this.citeGate.raw);
  }

  /**
   * Claim-scoped corpus authoring (spec-baseline-slice-2 §C8, AC-BLS2-8): armed post-construction
   * by `adapters/cli/loader.ts`; absent ⇒ `citeCriterion` is ungated, byte-identical to before.
   */
  private writeAuthority: CorpusWriteAuthority | undefined;

  /** Arms the claim-scoped corpus-write guard for {@link citeCriterion}. Called once per CLI process. */
  setCorpusWriteContext(context: CorpusWriteAuthorityContext): void {
    this.writeAuthority = new CorpusWriteAuthority(this.store, context, this.writer);
  }

  /**
   * From a linked worktree, a cite write is authorized by the BASELINE RULES it names, not by the
   * spec it lands on: every cited rule must live on a leaf under the lease's `corpus_scope` branch.
   * A rule id that no leaf carries cannot be proven in scope, so it refuses (inert outside a
   * foreign crossing — the authority short-circuits before any lookup matters).
   */
  private async authorizeCite(ruleIds: readonly string[], by: string | undefined): Promise<Result<void, LoreError>> {
    if (this.writeAuthority === undefined) return ok(undefined);
    const leaves = await this.store.findMany({ type: "baseline" });
    if (!leaves.ok) return leaves;
    const carrying = new Map<string, DocRecord>();
    for (const leaf of leaves.value) {
      const rules = leaf.extra["rules"];
      if (!Array.isArray(rules)) continue;
      for (const rule of rules as Array<{ id?: unknown }>) {
        if (typeof rule.id === "string" && ruleIds.includes(rule.id)) carrying.set(rule.id, leaf);
      }
    }
    const known = ruleIds.map((id) => carrying.get(id));
    const allCarried = known.every((t) => t !== undefined);
    // reason: an uncarried id cannot be proven in scope; an EMPTY target set never authorizes
    // (CorpusWriteAuthority.findCoveringGrant), so a foreign crossing refuses while an own-corpus
    // write stays inert.
    const targets = allCarried ? [...new Set(known as DocRecord[])] : [];
    const actor = resolveWriteActorFor(this.store, by);
    const verdict = await this.writeAuthority.authorize(targets, "ac-cite", actor);
    if (!verdict.ok) return verdict;
    return ok(undefined);
  }

  // ── addCriterion ──────────────────────────────────────────────────────────

  /**
   * Append a new acceptance criterion to a spec's `extra.acceptance_criteria`.
   * The FULL candidate array (existing + new) is validated via
   * `specAcceptanceCriteriaSchema` before writing — malformed shape, duplicate id, or
   * exceeding the 50-entry cap all fail loud with the doc left unchanged.
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param criterion - Untrusted candidate criterion (validated here, not by the caller —
   *   CLI/MCP callers pass raw flag-assembled objects)
   * @param opts - D8 declaration-time path-existence check options (see
   *   {@link DeclarePathOpts}) — omitted entirely, the check is a no-op
   * @returns Updated criteria array after appending
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / malformed criterion / duplicate
   *   id / 51st entry / a script-mode command naming a path that does not exist and no
   *   non-empty `--allow-missing-path` reason was supplied), STALE_VERSION
   *
   * @example
   * await acService.addCriterion("spec-my-feature", {
   *   id: "AC-ACODE-1",
   *   statement: "Rejects malformed input",
   *   verify: { mode: "script", oracle: "test", command: "bunx vitest run x" },
   * });
   */
  async addCriterion(
    specIdOrSlug: string,
    criterion: unknown,
    opts: DeclarePathOpts = {},
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    // record-edit gate (spec-documents-are-living-or-records D6/D12): an added criterion changes what was
    // accepted, so it is refused on a locked spec - BEFORE any validation or write.
    const gate = await this.recordLock.assertEditable(spec, "criteria");
    if (!gate.ok) return gate;

    const existing = extractCriteria(spec);
    const candidate = [...existing, criterion];
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `acceptance_criteria.${issue.path.join(".")}` : "acceptance_criteria",
        message: issue !== undefined ? issue.message : "Invalid acceptance criterion",
        value: criterion,
      });
    }

    // reason: AC-Quantifiability Gate spec §Design — this is the PRIMARY, immediate
    // enforcement point (the spec-create/spec-promote gate predicate, `acQuantifiable`
    // in `gate-predicates.ts`, is the BACKSTOP that re-lints the whole declared set).
    // Lint ONLY the newly-appended entry — `existing` entries were already accepted
    // through this same check (or predate the gate; the backstop catches those at
    // spec-promote) — via the SAME zero-LLM `lintAcQuantifiability` lint, never a
    // second wordlist/heuristic. `parsed.data`'s last element is the validated form
    // of `criterion` (Zod array parsing preserves element order — `candidate` never
    // reorders `existing`).
    const newCriterion = parsed.data[parsed.data.length - 1];
    if (newCriterion !== undefined) {
      const findings = lintAcQuantifiability([newCriterion]).filter((f) => f.severity === "block");
      const finding = findings[0];
      if (finding !== undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: `acceptance_criteria.${finding.ac_id}`,
          message: finding.message,
          value: criterion,
        });
      }
    }

    // D8 — declaration-time path-existence check (task-promote-the-oracle-file-
    // existence-primitives-into-lore). `newCriterion` is the schema-VALIDATED
    // form (never raw `criterion`) so `checkDeclaredPathExistence` always reads
    // a well-shaped `verify` union.
    let declaration: AllowMissingPathDeclaration | undefined;
    if (newCriterion !== undefined) {
      const pathCheck = checkDeclaredPathExistence(newCriterion, opts);
      if (!pathCheck.ok) return pathCheck;
      if (pathCheck.value.declaration !== null) declaration = pathCheck.value.declaration;
    }

    // §C4 — report-only citation warnings, recorded in the audit entry (never rejected, never dropped).
    const addedCites = newCriterion?.cites;
    const citeAudit = addedCites !== undefined ? await this.citeAuditDetails(addedCites, spec.id) : undefined;
    if (citeAudit !== undefined && !citeAudit.ok) return citeAudit;

    const writeResult = await this.writeCriteria(spec, parsed.data, "add", {
      ...(opts.by !== undefined ? { by: opts.by } : {}),
      ...(opts.onAdvisory !== undefined ? { onAdvisory: opts.onAdvisory } : {}),
      ...(declaration !== undefined ? { declaration } : {}),
      ...(citeAudit !== undefined ? { auditDetails: citeAudit.value } : {}),
    });
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── citeCriterion ─────────────────────────────────────────────────────────

  /**
   * Add (or, with `remove`, drop) baseline rule citations on ONE declared criterion
   * (baseline slice 1 §C4, AC-BLS1-6). REPORT-ONLY: a dangling / deprecated / retired id is
   * WRITTEN and returned as a {@link CiteWarning}; it never rejects and never drops the id.
   * Ids are set-deduplicated. Citing is NOT a contract edit: like `addCriterion` it never
   * demotes an approved spec (the no-demote branch of `writeCriteria`); it writes exactly one
   * version row and one audit entry with `details.operation === "cite"`.
   *
   * @param ruleIds - `BR-<n>` ids; grammar / cap validated by the criterion schema
   * @param flags.remove - drop these ids instead of adding them (no warnings on removal)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / unknown AC / no ids / malformed id / over cap), STALE_VERSION
   */
  async citeCriterion(
    specIdOrSlug: string,
    acId: string,
    ruleIds: string[],
    flags: { remove?: boolean } = {},
    opts: { by?: string } = {},
  ): Promise<Result<{ criteria: AcceptanceCriterion[]; warnings: CiteWarning[] }, LoreError>> {
    if (ruleIds.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "cites",
        message: "lore ac cite requires at least one rule id (BR-<n>)",
        value: ruleIds,
      });
    }
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCriteria(spec);
    const index = existing.findIndex((c) => c.id === acId);
    if (index === -1) {
      const declaredIds = existing.map((c) => c.id);
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria[].id",
        message:
          declaredIds.length > 0
            ? `Acceptance criterion "${acId}" is not declared on this spec. Declared ids: ${declaredIds.join(", ")}`
            : `Acceptance criterion "${acId}" is not declared on this spec — no criteria are declared yet`,
        value: acId,
      });
    }
    const target = existing[index] as AcceptanceCriterion;
    const current = target.cites ?? [];
    const requested = [...new Set(ruleIds)];
    const authorized = await this.authorizeCite(requested, opts.by);
    if (!authorized.ok) return authorized;
    const next =
      flags.remove === true
        ? current.filter((id) => !requested.includes(id))
        : [...current, ...requested.filter((id) => !current.includes(id))];

    const { cites: _previous, ...rest } = target;
    const candidateArray = existing.map((c, i) =>
      i === index ? { ...rest, ...(next.length > 0 ? { cites: next } : {}) } : c,
    );
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidateArray);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `acceptance_criteria.${issue.path.join(".")}` : "acceptance_criteria",
        message: issue !== undefined ? issue.message : "Invalid acceptance criterion",
        value: ruleIds,
      });
    }

    const warningsResult =
      flags.remove === true ? ok<CiteWarning[]>([]) : await this.checkCites(requested, spec.id);
    if (!warningsResult.ok) return warningsResult;
    const warnings = warningsResult.value;

    const writeResult = await this.writeCriteria(spec, parsed.data, "cite", {
      ...(opts.by !== undefined ? { by: opts.by } : {}),
      acId,
      auditDetails: {
        cites: requested,
        cite_warnings: warnings,
        ...(flags.remove === true ? { remove: true } : {}),
      },
    });
    if (!writeResult.ok) return writeResult;
    return ok({ criteria: parsed.data, warnings });
  }

  /**
   * Judge `ids` against the baseline leaves (dangling / inactive) WITHOUT writing — the CLI
   * re-uses it to print the same warnings `add`/`set` recorded in the audit entry. Reads the
   * store directly — no RuleService dependency.
   */
  async checkCites(ids: readonly string[], specIdOrSlug?: string): Promise<Result<CiteWarning[], LoreError>> {
    const leaves = await this.store.findMany({ type: "baseline" });
    if (!leaves.ok) return leaves;
    const warnings = citeWarnings(ids, buildRuleIndex(leaves.value));
    if (specIdOrSlug === undefined || warnings.length === 0) return ok(warnings);
    // reason: an id the citing spec's OWN change set proposes is citable (BR-86/BR-257), so it is not "dangling".
    const spec = await this.resolveSpec(specIdOrSlug);
    if (!spec.ok) return spec;
    const own = new Set(ownProposedRules(spec.value.extra).map((p) => p.id));
    return ok(warnings.filter((w) => !own.has(w.id)));
  }

  /** True when the corpus holds at least one baseline doc (gates the `ac add` no-cite hint — AC-BLS1-8). */
  async hasBaselineDocs(): Promise<Result<boolean, LoreError>> {
    const found = await this.store.findMany({ type: "baseline", limit: 1 });
    if (!found.ok) return found;
    return ok(found.value.length > 0);
  }

  private async citeAuditDetails(
    cites: readonly string[],
    specIdOrSlug: string,
  ): Promise<Result<Record<string, unknown>, LoreError>> {
    const w = await this.checkCites(cites, specIdOrSlug);
    if (!w.ok) return w;
    return ok({ cites: [...cites], cite_warnings: w.value });
  }

  // ── listCriteria ──────────────────────────────────────────────────────────

  /**
   * Return the declared criteria for a spec, plus per-AC evidence coverage (when the
   * spec has ≥1 child plan OR ≥1 governed ad-hoc task) and dangling `ac_ref` ids
   * (evidence pointing at ids no longer declared).
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param pathContext - OPTIONAL injected fs context (AC-TG-6). When supplied, every script criterion's
   *   command is checked against the live filesystem and each coverage fact carries `oracle_file_missing`
   *   (`[]` when checked and clean), which `deriveAcCoverageState` renders as `not_measured`. Omitted =
   *   the fact's field stays ABSENT ("not checked"), never `[]`.
   * @returns {@link AcListResult}
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec)
   */
  async listCriteria(
    specIdOrSlug: string,
    pathContext?: OraclePathContext,
  ): Promise<Result<AcListResult, LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;
    const criteria = extractCriteria(spec);

    const evidenceTasks = await findSpecEvidenceTasks(this.store, spec);
    if (!evidenceTasks.ok) return evidenceTasks;
    const { plans, adhocTasks, tasks } = evidenceTasks.value;

    const baseCoverage =
      plans.length > 0 || adhocTasks.length > 0 ? computeAcCoverage(criteria, tasks) : null;
    const coverage =
      baseCoverage !== null && pathContext !== undefined
        ? annotateMissingOracleFiles(
            baseCoverage,
            criteria,
            tasks,
            pathContext,
            new Set(extractAllowMissingPathDeclarations(spec).map((d) => d.ac_id)),
          )
        : baseCoverage;

    const declaredIds = new Set(criteria.map((c) => c.id));
    const danglingSet = new Set<string>();
    for (const task of tasks) {
      for (const entry of extractEvidence(task)) {
        if (entry.ac_ref !== undefined && !declaredIds.has(entry.ac_ref)) {
          danglingSet.add(entry.ac_ref);
        }
      }
    }

    const allowMissing = extractAllowMissingPathDeclarations(spec).map((d) => ({ ac_id: d.ac_id, reason: d.reason }));
    return ok({ criteria, coverage, dangling: Array.from(danglingSet).sort(), allow_missing_declarations: allowMissing });
  }

  // ── removeCriterion ───────────────────────────────────────────────────────

  /**
   * Remove a declared acceptance criterion from a spec.
   * Fails if any task under a child plan of the spec has evidence referencing this
   * id, unless `opts.force` is true (see class invariant — force never touches
   * existing evidence).
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param acId - Acceptance criterion id to remove (exact match)
   * @param opts - `{ force? }`
   * @returns Updated criteria array after removal
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / id not found / evidence
   *   references it without force), STALE_VERSION
   */
  async removeCriterion(
    specIdOrSlug: string,
    acId: string,
    opts: RemoveCriterionOpts = {},
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    // record-edit gate (spec-documents-are-living-or-records D6) - BEFORE any write.
    const gate = await this.recordLock.assertEditable(spec, "criteria");
    if (!gate.ok) return gate;

    const existing = extractCriteria(spec);
    if (!existing.some((c) => c.id === acId)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria[].id",
        message: `Acceptance criterion "${acId}" does not exist on this spec`,
        value: acId,
      });
    }

    if (opts.force !== true) {
      const plansResult = await findSpecChildPlans(this.store, spec.id);
      if (!plansResult.ok) return plansResult;
      const tasksResult = await findTasksUnderPlans(this.store, plansResult.value);
      if (!tasksResult.ok) return tasksResult;

      const referencingTask = tasksResult.value.find((task) =>
        extractEvidence(task).some((entry) => entry.ac_ref === acId),
      );
      if (referencingTask !== undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "acceptance_criteria[].id",
          message:
            `Cannot remove "${acId}" — task "${referencingTask.slug}" has evidence referencing it. ` +
            "Pass --force to remove anyway (existing evidence keeps its ac_ref and becomes dangling).",
          value: acId,
        });
      }
    }

    const updated = existing.filter((c) => c.id !== acId);
    const writeResult = await this.writeCriteria(
      spec,
      updated,
      "remove",
      opts.by !== undefined ? { by: opts.by } : {},
    );
    if (!writeResult.ok) return writeResult;
    return ok(updated);
  }

  // ── setCriterion ──────────────────────────────────────────────────────────

  /**
   * Edit ONE declared acceptance criterion in place — `id` stable, every OTHER
   * criterion and every other `extra` key untouched (D6), no `--force`, ever.
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param acId - The criterion's id (unchanged by this call — see {@link SetCriterionPatch})
   * @param patch - Fields to replace; at least one MUST be present (D3 — a
   *   completely-empty patch is VALIDATION_ERROR here as defense in depth, though the
   *   CLI already refuses it pre-service at exit 2, argv-decidable, before this method
   *   is ever called — D5a)
   * @param opts - D8 declaration-time path-existence check options (see
   *   {@link DeclarePathOpts}) — omitted entirely, the check is a no-op
   * @returns Updated criteria array (all entries, target replaced in place)
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / empty patch / unknown id,
   *   naming the declared ids (D4) / a mode-inconsistent flag, naming the flag and the
   *   criterion's actual mode (D5) / malformed resulting shape / a script-mode command
   *   naming a path that does not exist and no non-empty `--allow-missing-path` reason
   *   was supplied), STALE_VERSION
   *
   * @example
   * await acService.setCriterion("spec-my-feature", "AC-ACODE-1", {
   *   statement: "Rejects malformed input with a named field",
   * });
   */
  async setCriterion(
    specIdOrSlug: string,
    acId: string,
    patch: SetCriterionPatch,
    opts: SetCriterionOpts = {},
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
    const hasAnyField =
      patch.statement !== undefined ||
      patch.oracle !== undefined ||
      patch.command !== undefined ||
      patch.timeout_ms !== undefined ||
      patch.rubric !== undefined ||
      patch.note !== undefined ||
      patch.covers !== undefined ||
      patch.cites !== undefined ||
      patch.falsifier !== undefined;
    if (!hasAnyField) {
      return err({
        code: "VALIDATION_ERROR",
        field: "patch",
        message:
          "lore ac set requires at least one field to change: --statement, --oracle, --command, --rubric, " +
          "--note, --covers, --cite, --falsifier-path/-find/-replace/-exit-code",
        value: patch,
      });
    }

    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    // record-edit gate (spec-documents-are-living-or-records D6) - BEFORE any write. For a locked spec the
    // edit is refused instead of demoting the spec (the demotion below now only serves an unlocked spec).
    // reason: BR-1069/D2 — a correction on a LOCKED spec skips ONLY this gate and the demotion below; an
    // empty reason is refused before anything else. On an unlocked spec the gate is a no-op and the reason
    // is still recorded (D3).
    const correction = opts.correction;
    let correctionApplies = false;
    if (correction !== undefined) {
      if (correction.reason.trim().length === 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "correction.reason",
          message: "a correction needs a non-empty reason (--correction \"<why this is a fix, not a change>\")",
          value: correction.reason,
        });
      }
      const lock = await this.recordLock.resolve(spec);
      if (!lock.ok) return lock;
      correctionApplies = lock.value.standing === "record" && lock.value.locked;
    }
    if (!correctionApplies) {
      const gate = await this.recordLock.assertEditable(spec, "criteria");
      if (!gate.ok) return gate;
    }

    const existing = extractCriteria(spec);
    const index = existing.findIndex((c) => c.id === acId);
    if (index === -1) {
      const declaredIds = existing.map((c) => c.id);
      return err({
        code: "VALIDATION_ERROR",
        field: "acceptance_criteria[].id",
        message:
          declaredIds.length > 0
            ? `Acceptance criterion "${acId}" is not declared on this spec. Declared ids: ${declaredIds.join(", ")}`
            : `Acceptance criterion "${acId}" is not declared on this spec — no criteria are declared yet`,
        value: acId,
      });
    }
    const target = existing[index] as AcceptanceCriterion;

    // D5 — mode-inconsistent flag guard: VALIDATION_ERROR (document-state fault,
    // D5a) naming BOTH the offending flag and the criterion's actual mode. Checked
    // in a fixed order (oracle, command, rubric, note) so a caller passing more
    // than one wrong flag at once still gets a single deterministic message.
    const mode = target.verify.mode;
    if (patch.oracle !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--oracle", mode));
    }
    if (patch.command !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--command", mode));
    }
    if (patch.timeout_ms !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--timeout-ms", mode));
    }
    if (patch.falsifier !== undefined && mode !== "script") {
      return err(modeMismatchError(acId, "--falsifier-*", mode));
    }
    if (patch.rubric !== undefined && mode !== "ai") {
      return err(modeMismatchError(acId, "--rubric", mode));
    }
    if (patch.note !== undefined && mode !== "human") {
      return err(modeMismatchError(acId, "--note", mode));
    }

    const verifyCandidate = buildVerifyCandidate(target.verify, patch);
    const nextOracleGeneration = resolveNextOracleGeneration(target, verifyCandidate);
    const candidateCriterion: Record<string, unknown> = {
      id: target.id,
      statement: patch.statement ?? target.statement,
      verify: verifyCandidate,
      ...(patch.covers !== undefined
        ? { requirement_refs: patch.covers }
        : target.requirement_refs !== undefined
          ? { requirement_refs: target.requirement_refs }
          : {}),
      // §C4 — `cites` REPLACES when patched; otherwise the stored list is carried through
      // (omitting it here would silently drop every existing citation on any other edit).
      ...(patch.cites !== undefined
        ? patch.cites.length > 0
          ? { cites: patch.cites }
          : {}
        : target.cites !== undefined
          ? { cites: target.cites }
          : {}),
      // §M5 (AC-DC-8) — a rewritten script-mode command is a NEW ORACLE GENERATION;
      // every other edit carries the stored value through untouched (absent included,
      // so a statement-only edit stays byte-identical to pre-M5 behavior). See
      // `resolveNextOracleGeneration`'s own JSDoc.
      ...(nextOracleGeneration !== undefined ? { oracle_generation: nextOracleGeneration } : {}),
    };

    const candidateArray = existing.map((c, i) => (i === index ? candidateCriterion : c));
    const parsed = specAcceptanceCriteriaSchema.safeParse(candidateArray);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue !== undefined ? `acceptance_criteria.${issue.path.join(".")}` : "acceptance_criteria",
        message: issue !== undefined ? issue.message : "Invalid acceptance criterion",
        value: candidateCriterion,
      });
    }

    // D8 — declaration-time path-existence check (task-promote-the-oracle-file-
    // existence-primitives-into-lore). Checked against `parsed.data[index]` (the
    // schema-VALIDATED edited entry), so an edit that only touches `--statement`/
    // `--covers` on a script-mode criterion still re-checks the (possibly
    // untouched) command — cheap and correct: a re-check of an unmodified,
    // already-existing path is a guaranteed no-op.
    const editedCriterion = parsed.data[index];
    let declaration: AllowMissingPathDeclaration | undefined;
    // reason: issue #179 (task-gh-1343388703-179) — the path check guards a NEWLY declared command. A
    // statement/rubric/note-only edit leaves `verify.command` byte-identical, so re-validating it would force
    // `--allow-missing-path` again on a red-first AC whose test is not on disk yet. Do not "simplify" this
    // back to an unconditional check.
    const commandChanged =
      editedCriterion !== undefined &&
      !(
        editedCriterion.verify.mode === "script" &&
        target.verify.mode === "script" &&
        editedCriterion.verify.command === target.verify.command
      );
    if (editedCriterion !== undefined && commandChanged) {
      const pathCheck = checkDeclaredPathExistence(editedCriterion, opts);
      if (!pathCheck.ok) return pathCheck;
      if (pathCheck.value.declaration !== null) declaration = pathCheck.value.declaration;
    }

    // D2 — the SHARED demotion rule (`@lore/core`, beside VALID_TRANSITIONS; the
    // same function CorpusService.set calls — see class invariant above): an
    // approved spec demotes to draft on this edit, a non-approved spec's status is
    // untouched. `true` is passed literally because reaching this line means a
    // field WAS edited — the no-field-flag case already returned VALIDATION_ERROR
    // (D3) — and every editable field on a criterion is governing contract content.
    // reason: D5 — a correction on a locked spec keeps the status (no approved→draft, no re-approval write).
    const newStatus = correctionApplies ? spec.status : resolveStatusAfterContractEdit(spec.status, true);

    const citeAudit = patch.cites !== undefined ? await this.citeAuditDetails(patch.cites, spec.id) : undefined;
    if (citeAudit !== undefined && !citeAudit.ok) return citeAudit;

    const writeResult = await this.writeCriteria(spec, parsed.data, "set", {
      ...(correction !== undefined ? { correctionReason: correction.reason.trim() } : {}),
      ...(opts.by !== undefined ? { by: opts.by } : {}),
      ...(opts.onAdvisory !== undefined ? { onAdvisory: opts.onAdvisory } : {}),
      status: newStatus,
      acId,
      ...(declaration !== undefined ? { declaration } : {}),
      ...(citeAudit !== undefined ? { auditDetails: citeAudit.value } : {}),
    });
    if (!writeResult.ok) return writeResult;
    return ok(parsed.data);
  }

  // ── countUnredeemedAllowMissingPath ───────────────────────────────────────

  /**
   * Corpus-wide count of UNREDEEMED `--allow-missing-path` declarations — an
   * AC that exercised the D8 escape at declaration time whose declared
   * script-mode command STILL names a path absent from disk (AC-OX-9,
   * spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §D8).
   *
   * Recomputed FRESH from the live filesystem on every call via the SAME
   * `findMissingOracleFiles` (`@lore/core`) the write-path check uses — never
   * a cached/stored boolean. Creating the previously-missing file makes the
   * count drop on the very next call, with NO further command: that liveness
   * is the entire point of tracking the escape instead of letting it become
   * an untracked silent fallback (D8's own "make the ambiguity visible and
   * attributable" resolution).
   *
   * A declaration whose `ac_id` no longer names a CURRENTLY-declared
   * criterion (the AC was removed via {@link removeCriterion}, or its mode
   * changed away from `script` via `rm`+`add`) is silently excluded — removal
   * is itself a valid way to resolve a stale declaration, so no separate
   * cleanup step runs on `removeCriterion` itself.
   *
   * @param pathContext - the same injected fs context {@link DeclarePathOpts}
   *   accepts — REQUIRED here (unlike the opt-in write-path check): a count
   *   with no filesystem to check against is meaningless, so this method has
   *   no no-op mode.
   * @returns the corpus-wide unredeemed count — `0` when nothing was ever
   *   declared, or every declared path now exists
   * @throws whatever `StoreInterface.findMany` throws (STORE_ERROR family)
   */
  async countUnredeemedAllowMissingPath(
    pathContext: OraclePathContext,
  ): Promise<Result<number, LoreError>> {
    const listResult = await this.listUnredeemedAllowMissingPath(pathContext);
    if (!listResult.ok) return listResult;
    return ok(listResult.value.length);
  }

  /**
   * The MEMBER LIST behind {@link countUnredeemedAllowMissingPath} — task-
   * raise-the-evidence-tail-guard-s-predicate-to-its-own (AC-FR-5): a
   * corpus-wide count with no way to enumerate its members is not
   * actionable (measured 2026-08-10 — producing this exact list for
   * `pass_unfalsified_count=29` required a throwaway script iterating all
   * 138 specs by hand). `countUnredeemedAllowMissingPath` now DERIVES its
   * number from this list's length — one iteration, never two independently
   * maintained copies of "which declarations are still unredeemed".
   *
   * @param pathContext - same REQUIRED injected fs context as {@link
   *   countUnredeemedAllowMissingPath} — recomputed fresh from the live
   *   filesystem every call, never cached.
   * @returns one entry per unredeemed declaration, `"<spec-slug>#<ac-id>"` —
   *   stable, greppable, and sufficient to locate the offending
   *   `--allow-missing-path` declaration via `lore ac list <spec-slug>`.
   */
  async listUnredeemedAllowMissingPath(
    pathContext: OraclePathContext,
  ): Promise<Result<string[], LoreError>> {
    const specsResult = await this.store.findMany({ type: "spec" });
    if (!specsResult.ok) return specsResult;

    const unredeemed: string[] = [];
    for (const spec of specsResult.value) {
      const declarations = extractAllowMissingPathDeclarations(spec);
      if (declarations.length === 0) continue;

      const criteriaById = new Map(extractCriteria(spec).map((c) => [c.id, c] as const));
      for (const declaration of declarations) {
        const criterion = criteriaById.get(declaration.ac_id);
        if (criterion === undefined || criterion.verify.mode !== "script") continue;

        const missing = findMissingOracleFiles(criterion.verify.command, {
          cwd: pathContext.cwd,
          ...(pathContext.corpusRoot !== undefined ? { corpusRoot: pathContext.corpusRoot } : {}),
          fileExists: pathContext.fileExists,
        });
        if (missing.length > 0) unredeemed.push(`${spec.slug}#${declaration.ac_id}`);
      }
    }
    return ok(unredeemed);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a spec document. */
  private async resolveSpec(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "spec") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a spec document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /**
   * Shared CAS-guarded write path for addCriterion/removeCriterion/setCriterion: bumps
   * the spec's version, writes one insertVersion snapshot, then one audit entry (action
   * "update", actor "system") — same shape as CorpusService.set's spec-extra write, so
   * AuditService.verify's versions⋈audit completeness oracle needs no special case.
   *
   * @param opts.status - Explicit status to write (setCriterion's D2 demotion); omitted
   *   for add/remove, which never change status — defaults to `spec.status` unchanged.
   * @param opts.acId - The edited criterion's id, for setCriterion's change_summary/audit
   *   `details` only (add/remove operate on the whole array, no single id to name).
   * @param opts.declaration - A NEW/updated D8 `--allow-missing-path` declaration to
   *   upsert into `spec.extra.allow_missing_path_declarations` (task-promote-the-
   *   oracle-file-existence-primitives-into-lore) — omitted when
   *   `checkDeclaredPathExistence` produced none (the common case: no path was
   *   missing, or the check did not run at all).
   */
  private async writeCriteria(
    spec: DocRecord,
    criteria: AcceptanceCriterion[],
    operation: "add" | "remove" | "set" | "cite",
    opts: {
      status?: DocRecord["status"];
      acId?: string;
      declaration?: AllowMissingPathDeclaration;
      /** Extra audit `details` keys (§C4: `cites`, `cite_warnings`) — spread BEFORE the fixed keys so they can never shadow them. */
      auditDetails?: Record<string, unknown>;
      /** The calling actor; omitted → the env actor chain (see writeCriteria). */
      by?: string;
      /** Receives each chokepoint advisory once the write has committed ({@link DeclarePathOpts.onAdvisory}). */
      onAdvisory?: (advisory: string) => void;
      /** Trimmed correction reason (setCriterion only): change_summary `Correction: <reason>` + audit `details.correction`. */
      correctionReason?: string;
    } = {},
  ): Promise<Result<DocRecord, LoreError>> {
    const now = new Date().toISOString();
    const newExtra: Record<string, unknown> = { ...spec.extra, acceptance_criteria: criteria };
    // The sanctioned half of the AC write chokepoint (spec-baseline-slice-2 §C3): every verb's
    // write is declared through the SAME function CorpusService's wholesale paths are refused by.
    const gate = applyAcChange("ac-verb", spec.extra, newExtra, spec.id);
    if (!gate.ok) return gate;
    // Same resolution CorpusService.resolveWriteActor applies (SPEC-079 G2): explicit `by`, else
    // session tier → OS username. Never the literal "system" — that was the defect.
    const actor = resolveWriteActorFor(this.store, opts.by);
    if (opts.declaration !== undefined) {
      newExtra["allow_missing_path_declarations"] = upsertAllowMissingPathDeclaration(
        extractAllowMissingPathDeclarations(spec),
        opts.declaration,
      );
    }
    const newStatus = opts.status ?? spec.status;

    // The citation gate (spec-baseline-slice-2 §C4) — decided by the SAME chokepoint module, before any
    // write, so a refusal leaves the spec's extra, version, status and version log untouched. A removal
    // can add or revise nothing, so it is never gated.
    const existing = extractCriteria(spec);
    const target = { id: spec.id as string, slug: spec.slug, anchors: codeAnchorsOf(spec) };
    let requireLiveRules: string[] = [];
    let wouldRefuseAudit: AuditEntry[] = [];
    if (this.citeGate !== undefined && operation !== "remove") {
      const admission = await admitAcWrite(this.store, {
        rawGateConfig: this.citeGate.raw,
        target,
        existing,
        next: criteria,
        actor,
      });
      if (!admission.ok) return admission;
      requireLiveRules = admission.value.requireLiveRules;
      wouldRefuseAudit = admission.value.wouldRefuseAudit;
    }

    // ONE atomic composite write (doc CAS + version row + audit row + any would-refuse rows). The
    // liveness of every cited rule is re-read INSIDE this write's transaction (D6): a concurrent
    // retire either committed first — and the write is refused — or waits for this commit.
    // reason: the record lock was asked by the verb before it got here (lock "none"). A foreign crossing is allowed
    // only for a cite that `authorizeCite` already cleared against the lease's corpus scope (armed authority); every
    // other AC verb has no declared-intent fact, so from a linked worktree the route refuses it.
    const outcome = await this.writer.writeDoc({
      doc: spec,
      patch: { extra: newExtra, status: newStatus },
      action: "update",
      changeSummary:
        opts.correctionReason !== undefined
          ? `Correction: ${opts.correctionReason}`
          : operation === "set"
          ? buildSetChangeSummary(criteria.length, opts.acId, spec.status, newStatus)
          : operation === "cite"
            ? `Acceptance criterion ${opts.acId ?? ""} citations updated — ${criteria.length} entries`
            : `Acceptance criteria ${operation === "add" ? "updated" : "updated (removal)"} — ${criteria.length} entries`,
      auditAction: "update",
      auditDetails: {
        ...(opts.auditDetails ?? {}),
        operation,
        criteria_count: criteria.length,
        ...(opts.acId !== undefined ? { ac_id: opts.acId } : {}),
        ...(opts.correctionReason !== undefined ? { correction: { reason: opts.correctionReason } } : {}),
      },
      lock: "none",
      by: actor,
      now,
      foreignIntent: operation === "cite" && this.writeAuthority !== undefined,
      extras: {
        ...(requireLiveRules.length > 0 ? { require_live_rules: requireLiveRules } : {}),
        ...(wouldRefuseAudit.length > 0 ? { also_audit: wouldRefuseAudit } : {}),
      },
    });
    const written: Result<DocRecord, LoreError> = outcome.ok ? ok(outcome.value.doc) : outcome;
    if (!written.ok) {
      return { ok: false, error: await decorateCiteRefusal(this.store, written.error, { target, existing, next: criteria }) };
    }
    for (const advisory of pipeAdvisories(existing, criteria)) opts.onAdvisory?.(advisory);
    return written;
  }
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the validated acceptance criteria array from a spec DocRecord.
 * Returns [] when extra.acceptance_criteria is absent or fails schema validation —
 * schema-based (not duck-typed) since the discriminated `verify` union is too
 * structural for a hand-rolled type guard to safely narrow.
 */
function codeAnchorsOf(spec: DocRecord): string[] {
  const anchors = spec.extra["code_anchors"];
  return Array.isArray(anchors) ? (anchors as unknown[]).filter((a): a is string => typeof a === "string") : [];
}

/** Pure. A spec's well-formed criteria (`[]` when unparseable). Exported so `scripts/check-ac-oracle-ownership-corpus.ts` shares the rule (SSOT). */
export function extractCriteria(spec: DocRecord): AcceptanceCriterion[] {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  return parsed.success ? parsed.data : [];
}

/**
 * D8 declaration-time path-existence check for ONE candidate criterion
 * (task-promote-the-oracle-file-existence-primitives-into-lore,
 * spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §M6.3/D8).
 *
 * Deliberately does NOT reuse `evidence-precheck.ts`'s shared
 * `isSelfReportedPassInScope` — that gate answers "is this a self-reported
 * TEST/E2E PASS", a question with no meaning for AC DECLARATION (there is no
 * `result` here at all). Widening it to also cover this call site would
 * silently arm evidence-precheck.ts's OTHER four guards (2/3/5) for a
 * direction none of them reason about — an explicit non-negotiable
 * constraint of this task. This check's own, narrow scope is instead: a
 * `script`-mode criterion, checked at declaration time, with its own D8
 * escape — nothing shared with the evidence-write guards beyond the promoted
 * `findMissingOracleFiles` primitive itself.
 *
 * @param candidate - the schema-VALIDATED candidate criterion (never the raw,
 *   untrusted input) — `addCriterion` passes `parsed.data`'s new entry,
 *   `setCriterion` passes `parsed.data[index]`'s edited entry
 * @param opts - see {@link DeclarePathOpts}
 * @returns `err(VALIDATION_ERROR)` when a missing path was found with no (or
 *   whitespace-only) `allowMissingPath` reason; otherwise
 *   `ok({ declaration })` where `declaration` is:
 *   - `null` when the check did not run at all (`opts.pathContext` omitted),
 *     the criterion is not `script` mode, or every extracted path resolves —
 *     THREE cases collapsed into one "nothing to track" value, since none of
 *     them produces a stale escape to redeem later
 *   - a NEW {@link AllowMissingPathDeclaration} ONLY when the escape was
 *     genuinely exercised (≥1 path is missing AND a non-empty reason was
 *     supplied) — the caller persists this via {@link AcService.writeCriteria}
 */
function checkDeclaredPathExistence(
  candidate: { id: string; verify: AcceptanceCriterion["verify"] },
  opts: DeclarePathOpts,
): Result<{ declaration: AllowMissingPathDeclaration | null }, LoreError> {
  const { pathContext } = opts;
  if (pathContext === undefined) return ok({ declaration: null });
  if (candidate.verify.mode !== "script") return ok({ declaration: null });

  const missing = findMissingOracleFiles(candidate.verify.command, {
    cwd: pathContext.cwd,
    ...(pathContext.corpusRoot !== undefined ? { corpusRoot: pathContext.corpusRoot } : {}),
    fileExists: pathContext.fileExists,
  });
  if (missing.length === 0) return ok({ declaration: null });

  const reason = opts.allowMissingPath;
  if (reason === undefined || reason.trim().length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "verify.command",
      message:
        `Declared script-mode command names path(s) that do not exist yet: ${missing.join(", ")}. ` +
        "A red-first AC may legitimately name a test not yet written — pass a non-empty " +
        '--allow-missing-path "<reason>" to declare it explicitly. The declaration is then ' +
        "tracked as UNREDEEMED (lore status --json's unredeemed-declaration count) until the " +
        "file exists — creating it drops the count on the next read, no further command needed.",
      value: candidate.verify.command,
    });
  }

  return ok({
    declaration: {
      ac_id: candidate.id,
      reason: reason.trim(),
      declared_at: new Date().toISOString(),
    },
  });
}

/**
 * Extracts the well-formed subset of `spec.extra.allow_missing_path_declarations`
 * — malformed/legacy entries are silently dropped rather than thrown on, the
 * SAME fail-closed-on-read convention `extractCriteria` already uses for
 * `acceptance_criteria` itself. This key lives OUTSIDE `acceptance_criteria`
 * (never as a field on a criterion's own `verify` object) because
 * `specAcceptanceCriteriaSchema`'s per-criterion `z.object()` schemas use
 * Zod's default "strip unknown keys" behavior — an extra field on `verify`
 * would be silently DROPPED on the very next `safeParse`, which is exactly
 * the untracked-silent-fallback shape D8 exists to prevent.
 */
/** Pure. Exported for the same SSOT reason as {@link extractCriteria}. */
export function extractAllowMissingPathDeclarations(spec: DocRecord): AllowMissingPathDeclaration[] {
  const raw = spec.extra["allow_missing_path_declarations"];
  if (!Array.isArray(raw)) return [];
  const declarations: AllowMissingPathDeclaration[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record["ac_id"] === "string" &&
      typeof record["reason"] === "string" &&
      typeof record["declared_at"] === "string"
    ) {
      declarations.push({ ac_id: record["ac_id"], reason: record["reason"], declared_at: record["declared_at"] });
    }
  }
  return declarations;
}

/**
 * Upserts `next` into `existing` by `ac_id` — a re-declaration for the same
 * criterion (e.g. `setCriterion` editing an already-escaped command again)
 * REPLACES the prior reason/timestamp rather than accumulating duplicates.
 */
function upsertAllowMissingPathDeclaration(
  existing: AllowMissingPathDeclaration[],
  next: AllowMissingPathDeclaration,
): AllowMissingPathDeclaration[] {
  return [...existing.filter((d) => d.ac_id !== next.ac_id), next];
}

/**
 * Build the candidate `verify` object for {@link AcService.setCriterion} — mode is
 * ALWAYS carried over from `existingVerify` unchanged (D1: not editable through this
 * verb); each mode-specific field is `patch`'s value when supplied, else the
 * existing value. Deliberately returns `Record<string, unknown>` (not the typed
 * `AcceptanceCriterion["verify"]` union) — same pattern `commands/ac.ts`'s
 * `buildCriterionCandidate` already uses for `add`: the candidate is validated by
 * `specAcceptanceCriteriaSchema.safeParse` immediately after, which is the single
 * source of truth for shape correctness, not this assembly step.
 */
function buildVerifyCandidate(
  existingVerify: AcceptanceCriterion["verify"],
  patch: SetCriterionPatch,
): Record<string, unknown> {
  switch (existingVerify.mode) {
    case "script":
      return {
        mode: "script",
        oracle: patch.oracle ?? existingVerify.oracle,
        command: patch.command ?? existingVerify.command,
        // patch.timeout_ms: number replaces, null removes, undefined keeps the stored value.
        ...(patch.timeout_ms === null
          ? {}
          : patch.timeout_ms !== undefined
            ? { timeout_ms: patch.timeout_ms }
            : existingVerify.timeout_ms !== undefined
              ? { timeout_ms: existingVerify.timeout_ms }
              : {}),
        // reason: REQUIRE-ALL-FOUR-TOGETHER partial-update contract (see
        // SetCriterionPatch.falsifier's own JSDoc) — `patch.falsifier` REPLACES
        // the whole object wholesale when present (a partial candidate fails
        // `acFalsifierSchema` naming the missing field, never a silent
        // field-level merge onto `existingVerify.falsifier`); absent leaves the
        // existing falsifier (if any) untouched.
        ...(patch.falsifier !== undefined
          ? { falsifier: patch.falsifier }
          : existingVerify.falsifier !== undefined
            ? { falsifier: existingVerify.falsifier }
            : {}),
      };
    case "ai":
      return { mode: "ai", rubric: patch.rubric ?? existingVerify.rubric };
    case "human":
      return {
        mode: "human",
        ...(patch.note !== undefined
          ? { note: patch.note }
          : existingVerify.note !== undefined
            ? { note: existingVerify.note }
            : {}),
      };
  }
}

/**
 * The `oracle_generation` value {@link AcService.setCriterion} must write for this edit
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5, AC-DC-8).
 *
 * An acceptance criterion's ORACLE is its script-mode `verify.command`; rewriting that
 * command produces a criterion whose evidence history now spans two different oracles
 * under ONE id. The measured defect (spec §F3): `AC-BG-5` carried seven rows across
 * `grep -rq MARKER apps/web` (marker MUST exist) and `! grep -rq MARKER …` (marker MUST
 * NOT exist), two of them BOTH attested `exit_code: 0` — mutually exclusive facts reading
 * as ordinary green, with no write path able to mark either one superseded (`lore
 * evidence` is append-only with no amend; `lore invalidate` is whole-document; `lore
 * audit` is read-only; `lore set`'s field whitelist excludes evidence). Bumping the
 * generation here is what makes `computeAcCoverage` able to report the pre-rewrite rows
 * as prior-generation WITHOUT touching a single stored row.
 *
 * @param target - the CURRENTLY-STORED criterion (never the candidate)
 * @param candidateVerify - {@link buildVerifyCandidate}'s output for this edit — read
 *   for its `command` only, and defensively (it is a `Record<string, unknown>` whose
 *   shape `specAcceptanceCriteriaSchema` validates AFTER this call, so a non-string
 *   command is possible here and is treated as "no bump"; the schema then refuses the
 *   whole write, which is the loud path — never a bump on an invalid candidate)
 * @returns the value to write, or `undefined` to write NO `oracle_generation` key at all:
 *   - a NON-script criterion → the stored value, carried through unchanged (an `ai`
 *     rubric / `human` note has no executable oracle whose polarity can reverse)
 *   - a script criterion whose resulting command EQUALS the stored one → the stored
 *     value, carried through (idempotent: re-setting the identical command, or editing
 *     only `--statement`/`--covers`/`--falsifier-*`, is not a new oracle)
 *   - a script criterion whose resulting command DIFFERS → `resolveOracleGeneration`
 *     (`@lore/core` — the ONE "absent means generation 1" rule) of the stored value,
 *     PLUS ONE. Monotonic and never reused: it is derived from the stored value, so it
 *     can only increase, and it never resets to 1 (a first rewrite yields 2).
 */
function resolveNextOracleGeneration(
  target: AcceptanceCriterion,
  candidateVerify: Record<string, unknown>,
): number | undefined {
  if (target.verify.mode !== "script") return target.oracle_generation;
  const nextCommand = candidateVerify["command"];
  if (typeof nextCommand !== "string" || nextCommand === target.verify.command) {
    return target.oracle_generation;
  }
  return resolveOracleGeneration(target.oracle_generation) + 1;
}

/**
 * D5's VALIDATION_ERROR for a flag that does not apply to the target criterion's
 * mode — names BOTH the flag and the actual mode (D5: "accepting-and-dropping would
 * let a caller believe an oracle was rewritten when it was not"). Exit-4 family per
 * D5a: this is decidable only against the RESOLVED document's declared mode, never
 * from argv alone.
 */
function modeMismatchError(acId: string, flag: string, actualMode: AcVerifyMode): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "verify",
    message: `${flag} only applies to a "${modeFieldName(flag)}"-mode criterion — "${acId}" is mode "${actualMode}"`,
    value: { ac_id: acId, flag, mode: actualMode },
  };
}

/** The verify mode a given mode-specific flag belongs to (for modeMismatchError's message). */
function modeFieldName(flag: string): AcVerifyMode {
  if (flag === "--oracle" || flag === "--command" || flag === "--timeout-ms" || flag === "--falsifier-*") return "script";
  if (flag === "--rubric") return "ai";
  return "human";
}

/**
 * change_summary for a `setCriterion` write — names the edited id, and appends a
 * demotion note ONLY when this write actually moved the spec's status (AC-ACS-4:
 * the draft-stays-draft case must show no status-transition text at all).
 *
 * reason: the condition is `fromStatus !== toStatus` and the note interpolates the
 * OBSERVED pair, deliberately NOT the literals `"approved"`/`"draft"`. Hardcoding
 * them here would make this function a third partial copy of the demotion rule that
 * `resolveStatusAfterContractEdit` (`@lore/core`) owns — it would silently stop
 * annotating the write the day that rule's target status changes. For the
 * approved→draft transition the rendered text is byte-identical to the pre-SSOT
 * version ("(demoted approved → draft on edit)").
 */
function buildSetChangeSummary(
  count: number,
  acId: string | undefined,
  fromStatus: DocRecord["status"],
  toStatus: DocRecord["status"],
): string {
  const base = `Acceptance criterion "${acId ?? "?"}" updated — ${count} entries`;
  return fromStatus !== toStatus ? `${base} (demoted ${fromStatus} → ${toStatus} on edit)` : base;
}

/**
 * Stamps each script criterion's coverage fact with the test-file paths its CURRENT command names that
 * exist under no plausible root (AC-TG-6). Pure over its inputs plus the injected `fileExists`.
 *
 * @param coverage - {@link computeAcCoverage}'s facts, in criteria order
 * @param criteria - the spec's declared criteria
 * @param tasks - the tasks whose evidence produced `coverage` (their rows give each pass's command / execution root)
 * @param pathContext - injected fs context (never a real filesystem read here)
 * @param allowMissingAcIds - ids of the ACs declared with `--allow-missing-path` (red-first); stamped onto the fact as
 *   `allow_missing_declared` so {@link deriveAcCoverageState} can apply its one missing-oracle rule
 * @returns new facts (inputs untouched); non-script criteria keep the field ABSENT
 */
function annotateMissingOracleFiles(
  coverage: AcListResult["coverage"] & object,
  criteria: AcceptanceCriterion[],
  tasks: DocRecord[],
  pathContext: OraclePathContext,
  allowMissingAcIds: ReadonlySet<string>,
): AcListResult["coverage"] & object {
  const byId = new Map(criteria.map((c) => [c.id, c] as const));
  return coverage.map((fact) => {
    const criterion = byId.get(fact.ac_id);
    if (criterion === undefined || criterion.verify.mode !== "script") return fact;
    const rootCtx = {
      cwd: pathContext.cwd,
      ...(pathContext.corpusRoot !== undefined ? { corpusRoot: pathContext.corpusRoot } : {}),
    };
    const criterionCommand = criterion.verify.command;
    const missingPaths = findMissingOracleFiles(criterionCommand, { ...rootCtx, fileExists: pathContext.fileExists });
    // reason: AC-EI-2 removed TG-22's narrowing — this count is INFORMATION ONLY (deriveAcCoverageState never reads it).
    const passesRanMissingOracle = tasks
      .flatMap((task) => extractEvidence(task))
      .filter(
        (entry) =>
          entry.ac_ref === fact.ac_id &&
          entry.result === "pass" &&
          evidenceRanMissingOracle(
            {
              command: entry.command,
              ...(entry.attestation?.execution_root !== undefined ? { executionRoot: entry.attestation.execution_root } : {}),
            },
            { command: criterionCommand, missingPaths },
            rootCtx,
          ),
      ).length;
    return {
      ...fact,
      oracle_file_missing: missingPaths,
      allow_missing_declared: allowMissingAcIds.has(fact.ac_id),
      passes_ran_missing_oracle: passesRanMissingOracle,
      oracle_paths_unchecked: findUncheckedOracleSegments(criterionCommand),
    };
  });
}
