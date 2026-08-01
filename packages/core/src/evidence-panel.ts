/**
 * Evidence-panel SSOT (SPEC-075 §Design Decisions D2/D6/D10) — the single home for
 * the dashboard adjudication workbench's per-doc-type evidence projection shape, the
 * plan-wide attestation-ratio math, and the task-attestation counting primitive that
 * both this projection AND `gate-predicates.ts::attestationFloor` (the `plan-close`
 * checkpoint predicate, SPEC-069) consume. Pure, browser-safe module: no IO, no
 * `Date.now()`/`Math.random()` calls.
 *
 * Public surface:
 *   - EvidencePanelProjection — a discriminated union (tag: `doc_type`) of the four
 *     shapes the dashboard Evidence tab renders: task / spec / plan / other.
 *   - TaskAttestationInfo — one task's evidence/attested counts (MOVED here from
 *     `packages/lore/src/service/gate-predicates.ts`, which now imports the type
 *     rather than declaring it — SPEC-075 D6, "one type, one counting fn, one ratio
 *     fn, one file").
 *   - buildTaskAttestationInfos(tasks) — the evidence/attested counting SSOT. Mirrors
 *     EXACTLY the inline mapping `CorpusService.set`'s plan-close gate wiring used to
 *     perform (per-task `extractEvidence(task).length` / `.filter(attestation !==
 *     undefined).length`) — that call site now calls this function instead of
 *     re-deriving the same counts locally.
 *   - deriveAttestationSummary(infos, minRatio, acCoverage) — the plan-wide
 *     evidence facts (totals, ratio, the per-task zero-attested list, the
 *     exercised-AC coverage) plus `meets_floor`, which as of
 *     spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts (D5)
 *     carries the OPT-IN plan-wide ratio conjunct ALONE — that function's own
 *     JSDoc names which conditions were demoted to reported facts and where the
 *     declared-scope conjunct now lives.
 *   - deriveClaimedAcCoverage(coverage) — the EXERCISED-AC coverage fact,
 *     DESCRIPTIVE ONLY: which declared script-mode acceptance criteria this
 *     plan's evidence actually referenced (>= 1 `ac_ref`), and which of those
 *     remain unattested. Evidence-derived, so it must never define the scope it
 *     is audited against — hence `exercised_acs`, not `claimed_acs`.
 *   - deriveDeclaredScopeCoverage(tasks, coverage) — the DECLARED-scope coverage
 *     fact (§Facts D4, the plan-close conjunct's input): the union over
 *     evidence-bearing tasks of (`task.extra.ac_scope` ∩ the spec's declared
 *     script-mode criteria), its unattested subset, and whether ANY
 *     evidence-bearing task declared no scope at all.
 *   - declaredScopeCoverageVerdict(coverage, referent) — the plan-close coverage
 *     conjunct's three-valued verdict over that fact: a measured failure, an
 *     APPLICABILITY verdict when the scope is undeclared, or a pass.
 *   - summarizeForAdjudicationBar(panel) — compact chip-summary projection shared by
 *     the AdjudicationBar UI component.
 *   - derivePlanCloseChipStatus(meetsFloor, declaredScopeVerdict) — the ONE
 *     precedence combinator `summarizeForAdjudicationBar`'s `plan` branch
 *     applies over the SAME two already-resolved facts the dashboard's
 *     `PlanAttestationPanel.tsx::derivePlanAttestationBadgeState` combines
 *     (FAIL > NOT-APPLICABLE > PASS) — task-adjudicationbar-s-compact-status-
 *     chip-still-derives-from. Exported so the compact adjudication-bar chip
 *     and the full attestation panel badge can never re-diverge again: both
 *     read the SAME `meets_floor` + `declared_scope_verdict` facts through
 *     the SAME precedence rule, merely rendered under different labels
 *     (`"pass"`/`"fail"`/`"scope-undeclared"` here vs `"meets-floor"`/
 *     `"below-floor"`/`"scope-undeclared"` on the panel).
 *
 * Invariants:
 *   - `AttestationSummary.ratio` is `null`, never a fabricated `0`, when
 *     `total_evidence === 0` (SPEC-075 task packet, "never a fabricated 0") — the
 *     vacuous-pass case (a pure-planning plan/task with no evidence at all) has no
 *     meaningful ratio to report, and `0` would misleadingly render as "0% attested"
 *     rather than "not applicable".
 *   - `AttestationSummary.min_ratio` is `number | null` (spec-plan-close-predicates-
 *     measure-invariants-an-applicability §D4) — `null` means the ratio conjunct is
 *     UNCONFIGURED and therefore does not run at all; a caller must never coerce
 *     `null` to `0` (would misrender as "0% required") or to `0.5` (would claim an
 *     enforcement that is not happening).
 *   - `deriveAttestationSummary`'s vacuous-pass branch (`total_evidence === 0`)
 *     always yields `meets_floor: true` and `zero_attested_tasks: []` — mirrors
 *     `attestationFloor`'s own early-return for the same case (SPEC-069 §Scope,
 *     "the floor only constrains a plan that claims to have been verified"); it
 *     still reports the REAL `claimed_ac_coverage` facts (a facts function never
 *     fabricates a vacuous coverage value), it simply never lets them affect
 *     `meets_floor` in that branch — the predicate layer reports this case as
 *     NOT-APPLICABLE regardless of `meets_floor`'s value here.
 *   - `deriveClaimedAcCoverage` never filters by declared-id membership itself —
 *     its INPUT (`computeAcCoverage`'s own output) already emits exactly one row
 *     per DECLARED criterion (`acceptance.ts`'s own contract), so a dangling
 *     `ac_ref` naming an undeclared id is excluded STRUCTURALLY, before this
 *     function ever sees the data. Adding a second exclusion filter here would be
 *     redundant and risk silently diverging from that upstream contract.
 *   - `ExercisedAcCoverage` (evidence-derived) and `DeclaredScopeCoverage`
 *     (author-declared) are INDEPENDENT facts with NO fallback between them
 *     (spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts D4).
 *     Neither is ever computed from, or substituted for, the other: the defect
 *     that spec exists to remove is precisely evidence defining its own audit
 *     scope. A fixture where they DISAGREE (evidence present, nothing declared)
 *     is the oracle proving the independence (AC-VS-6) — never "reuse" one when
 *     the other is unresolved; use {@link UNRESOLVED_DECLARED_SCOPE}, which
 *     reports UNDECLARED.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-075 (dashboard adjudication workbench + route telemetry) §Design
 *   Decisions D2, D6, D10; SPEC-069 §Design Decisions D1 (attestationFloor, the
 *   predicate this module's math must stay byte-identical to);
 *   spec-plan-close-predicates-measure-invariants-an-applicability §D3
 *   (per-claimed-AC coverage as the default conjunct), §D4 (ratio default flip);
 *   spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts (D4 —
 *   the exercised/declared split; D5 — the demoted per-task floor);
 *   task-meets-floor-renders-pass-while-the-declared-scope-conjunct (the
 *   PlanAttestationPanel three-state badge fix); task-adjudicationbar-s-
 *   compact-status-chip-still-derives-from (this module's matching fix for
 *   the compact chip, so the two dashboard surfaces can no longer disagree).
 */

import type { AcCoverageFact, AcceptanceCriterion } from "./acceptance.js";
import { extractEvidence, type EvidenceEntry } from "./task-workflow.js";
import type { DocRecord } from "./types.js";

// ─── Task Attestation Counting ──────────────────────────────────────────────

/**
 * One task's (or, since `plan-close` also resolves SPEC-056 phase docs, one
 * phase's) evidence-attestation facts. MOVED from `gate-predicates.ts` (SPEC-075
 * D6) — `gate-predicates.ts` now imports this type rather than declaring it.
 */
export interface TaskAttestationInfo {
  slug: string;
  title: string;
  /** Total `verification_evidence[]` entries on this task. */
  evidenceCount: number;
  /** Of those, how many carry a runner-issued `attestation` object. */
  attestedCount: number;
}

/**
 * Derives one {@link TaskAttestationInfo} per input task — the evidence/attested
 * counting SSOT (SPEC-075 D6). Mirrors EXACTLY the counting
 * `CorpusService.set`'s plan-close gate wiring performed inline before this
 * function existed: `evidenceCount` is the task's total `verification_evidence[]`
 * length (via {@link extractEvidence}, the whole-array fail-closed parse), and
 * `attestedCount` is the subset carrying a defined `attestation` object.
 *
 * @param tasks - Task (or phase) documents to derive attestation facts for,
 *   typically a plan's resolved child tasks (`CorpusService.getPlanBundle`).
 * @returns One {@link TaskAttestationInfo} per input task, in input order. Never
 *   throws — a task with malformed/absent `extra.verification_evidence` yields
 *   `evidenceCount: 0, attestedCount: 0` (via `extractEvidence`'s own
 *   fail-closed-to-`[]` behavior).
 * @example
 * buildTaskAttestationInfos([taskWithTwoSelfReportedEntries]);
 * // => [{ slug: "task-x", title: "X", evidenceCount: 2, attestedCount: 0 }]
 */
export function buildTaskAttestationInfos(tasks: readonly DocRecord[]): TaskAttestationInfo[] {
  return tasks.map((task) => {
    const evidence: EvidenceEntry[] = extractEvidence(task);
    return {
      slug: task.slug,
      title: task.title,
      evidenceCount: evidence.length,
      attestedCount: evidence.filter((entry) => entry.attestation !== undefined).length,
    };
  });
}

// ─── Exercised-AC Coverage (spec-plan-close-predicates-measure-invariants-an- ─
// ─── applicability §D3, renamed by spec-declared-scope-attestation-contract- ──
// ─── task-owned-ac-scope §Facts D4) ──────────────────────────────────────────

/**
 * EXERCISED-AC attested-coverage facts — which declared script-mode acceptance
 * criteria this plan's EVIDENCE actually referenced, and which of those carry no
 * runner attestation.
 *
 * DESCRIPTIVE ONLY as of spec-declared-scope-attestation-contract-task-owned-
 * ac-scope §Facts (D4): this fact used to double as the plan-close coverage
 * conjunct's input, which made the audited evidence define its own audit scope
 * (a `lore verify <plan>` run with no `--ac` attested every declared AC onto one
 * task, and the conjunct then read those very entries). The conjunct now reads
 * {@link DeclaredScopeCoverage}; this fact stays for diagnostics and for the
 * dashboard Evidence tab, and MUST NOT be re-wired into any gate verdict.
 */
export interface ClaimedAcCoverage {
  /**
   * Declared script-mode criteria carrying >= 1 evidence reference, in
   * declaration order (the order {@link computeAcCoverage}'s own output
   * preserves). Named `exercised_acs`, never `claimed_acs`: a task's CLAIM is
   * what its author declared in `extra.ac_scope`
   * ({@link DeclaredScopeCoverage.declared_acs}); this array only records what
   * some evidence entry happened to reference. `ai`/`human`-mode criteria are
   * excluded — `lore verify` structurally cannot attest them, so demanding
   * their attestation would be a permanent false block (§D3(b)). A dangling
   * `ac_ref` naming an undeclared id can never appear here —
   * {@link computeAcCoverage} emits one row per DECLARED criterion only, so
   * this array's input already excludes dangling refs structurally (see this
   * module's header invariant).
   */
  exercised_acs: string[];
  /**
   * Subset of `exercised_acs` whose evidence carries ZERO runner attestation
   * (`attested_pass + attested_fail === 0` — never `attested_pass` alone, per
   * the spec's pinned counting rule: a runner-issued fail still proves the
   * runner ran that AC's registered command).
   */
  unattested_acs: string[];
  /** `unattested_acs.length === 0` — vacuously `true` when `exercised_acs` is
   *  empty. Reported for rendering only: no gate verdict may read it (D4). */
  meets_coverage: boolean;
}

/**
 * Derives {@link ClaimedAcCoverage} from {@link computeAcCoverage}'s own output —
 * never re-implements any counting (this module's header invariant). Because
 * `computeAcCoverage` emits exactly one row per DECLARED criterion, a dangling
 * `ac_ref` (evidence naming an id no longer declared) never appears in `coverage`
 * at all — this function needs no extra filter for that case.
 *
 * @param coverage - {@link computeAcCoverage}'s output (typically a plan's
 *   governing spec's declared criteria aggregated over the plan's tasks).
 * @returns The exercised set (script-mode, >=1 ref), its unattested subset, and
 *   whether every exercised criterion is attested. `{exercised_acs: [],
 *   unattested_acs: [], meets_coverage: true}` for an empty `coverage` input —
 *   a plan/spec pairing whose evidence references nothing has nothing to report.
 * @example
 * deriveClaimedAcCoverage([
 *   { ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [{task_id: "t", result: "pass", attested: true}], attested_pass: 1, attested_fail: 0 },
 *   { ac_id: "AC-2", mode: "script", pass: 1, fail: 0, refs: [{task_id: "t", result: "pass"}], attested_pass: 0, attested_fail: 0 },
 *   { ac_id: "AC-3", mode: "human", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0 },
 * ]);
 * // => { exercised_acs: ["AC-1", "AC-2"], unattested_acs: ["AC-2"], meets_coverage: false }
 * // (AC-3 excluded: human-mode; AC-3 also carries zero refs, so it would be
 * //  excluded on that ground alone even if it were script-mode)
 */
export function deriveClaimedAcCoverage(coverage: readonly AcCoverageFact[]): ClaimedAcCoverage {
  const exercised = coverage.filter((fact) => fact.mode === "script" && fact.refs.length > 0);
  const exercised_acs = exercised.map((fact) => fact.ac_id);
  const unattested_acs = exercised
    .filter((fact) => fact.attested_pass + fact.attested_fail === 0)
    .map((fact) => fact.ac_id);
  return { exercised_acs, unattested_acs, meets_coverage: unattested_acs.length === 0 };
}

// ─── Declared-Scope Coverage (spec-declared-scope-attestation-contract-task- ──
// ─── owned-ac-scope §Facts D4 — the plan-close coverage conjunct's input) ─────

/**
 * DECLARED-scope attested-coverage facts — the plan-close coverage conjunct's
 * ONLY input (spec-declared-scope-attestation-contract-task-owned-ac-scope
 * §Facts). Where {@link ClaimedAcCoverage} asks "which criteria did this plan's
 * evidence happen to touch", this asks "which criteria did the plan's task
 * AUTHORS declare they own, and were those runner-attested" — the audit scope is
 * therefore declared independently of the evidence being audited.
 */
export interface DeclaredScopeCoverage {
  /**
   * Union over evidence-bearing tasks of (`task.extra.ac_scope` ∩ the spec's
   * declared script-mode criteria), in DECLARATION order (the order
   * {@link computeAcCoverage}'s own output preserves — never task order, so the
   * value is stable under task reordering). The intersection is what excludes a
   * dangling declared id (one the spec no longer declares) and an `ai`/`human`-
   * mode id (which `lore verify` structurally cannot attest).
   */
  declared_acs: string[];
  /**
   * Subset of `declared_acs` whose evidence carries ZERO runner attestation
   * (`attested_pass + attested_fail === 0` — a runner-issued FAIL counts as
   * attested: it still proves the runner ran that AC's registered command).
   */
  unattested_acs: string[];
  /**
   * `true` iff at least one EVIDENCE-BEARING task carries no readable
   * `ac_scope` at all. A task with no evidence is never consulted — it has
   * nothing to audit, so its silence says nothing about scope. An EMPTY
   * `ac_scope: []` is a DECLARATION ("this task claims nothing") and keeps this
   * `false`; only an absent (or unreadable) field is undeclared — the authorial
   * distinction the governing spec's §Contract Details pins.
   */
  scope_undeclared: boolean;
  /** `unattested_acs.length === 0` — vacuously `true` when `declared_acs` is empty. */
  meets_coverage: boolean;
}

/**
 * The {@link DeclaredScopeCoverage} value a caller that never RESOLVED the fact
 * must pass — it reports the scope as UNDECLARED, so an unresolved referent can
 * only ever produce the (non-blocking, audited) applicability verdict, never a
 * fabricated compliant declaration.
 *
 * Exists because the alternative — an ad-hoc `?? {scope_undeclared: false, …}`
 * at each call site — would be a silent vacuous PASS of the conjunct: exactly
 * the proxy-for-invariant defect the governing spec removes. Do not "simplify"
 * a call site into building this shape inline with `scope_undeclared: false`.
 */
export const UNRESOLVED_DECLARED_SCOPE: DeclaredScopeCoverage = {
  declared_acs: [],
  unattested_acs: [],
  scope_undeclared: true,
  meets_coverage: true,
};

/** The machine-readable `reason` an undeclared scope produces — the single
 *  definition site, widened into `gate-predicates.ts`'s `NotApplicableReason`
 *  union by import so the two can never drift. */
export const SCOPE_UNDECLARED_REASON = "scope-undeclared";

/**
 * The plan-close coverage conjunct's three-valued verdict — a MEASURED failure
 * (some declared AC has zero attested evidence), an APPLICABILITY verdict (no
 * task declared a scope, so there is no claim to audit), or a pass.
 *
 * The not-applicable member deliberately carries NO `ok` property, mirroring
 * `gate-predicates.ts::PredicateNotApplicable`'s own shape: a consumer's
 * `if (!verdict.ok)` cannot compile until it narrows, so the third case can
 * never be silently routed into the pass branch. It is structurally assignable
 * to `PredicateNotApplicable` once {@link SCOPE_UNDECLARED_REASON} is in that
 * module's `NotApplicableReason` union, which is why `attestationFloor` can
 * return this value directly rather than re-building it.
 */
export type DeclaredScopeCoverageVerdict =
  | {
      readonly notApplicable: true;
      readonly reason: typeof SCOPE_UNDECLARED_REASON;
      readonly referent: string;
    }
  | { readonly ok: true }
  | { readonly ok: false; readonly unattested_acs: readonly string[] };

/**
 * Defensive three-valued `task.extra.ac_scope` read — `extra` is untyped
 * storage, so a legacy/corrupted row may hold anything.
 *
 * Distinct on purpose from `assessment.ts`'s module-private `extractAcScope`,
 * which collapses absent to `[]`: this module MUST tell "nobody declared a
 * scope" (→ `undefined`, the applicability verdict) apart from "an author
 * declared that this task claims nothing" (→ `[]`, a resolved declaration). A
 * two-valued accessor cannot express that distinction, which is the whole
 * subject of AC-VS-5/AC-VS-6 — do not consolidate the two readers.
 *
 * @param task - Any task (or phase) document; only its `extra.ac_scope` is read.
 * @returns The declared id array, or `undefined` when the field is absent OR
 *   unreadable (not an array, or an array containing a non-string). A malformed
 *   value is reported AS undeclared — the loud direction: it surfaces as the
 *   audited `scope-undeclared` advisory rather than as a compliant declaration.
 *   Never throws.
 * @example
 * findDeclaredAcScope({ extra: { ac_scope: ["AC-1"] } } as DocRecord); // => ["AC-1"]
 * @example
 * findDeclaredAcScope({ extra: { ac_scope: [] } } as DocRecord);       // => []
 * @example
 * findDeclaredAcScope({ extra: {} } as DocRecord);                     // => undefined
 */
export function findDeclaredAcScope(task: DocRecord): string[] | undefined {
  const extra: unknown = task.extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return undefined;
  const raw: unknown = (extra as Record<string, unknown>)["ac_scope"];
  if (!Array.isArray(raw)) return undefined;
  if (!raw.every((entry): entry is string => typeof entry === "string")) return undefined;
  return raw;
}

/**
 * Derives {@link DeclaredScopeCoverage} — the declared half of the coverage
 * conjunct — from the plan's task documents and {@link computeAcCoverage}'s own
 * output. Never re-implements attestation counting (this module's header
 * invariant): the attested/unattested classification comes from `coverage`'s own
 * `attested_pass`/`attested_fail`, exactly as {@link deriveClaimedAcCoverage}'s
 * does.
 *
 * Only EVIDENCE-BEARING tasks contribute (a task with no evidence has nothing
 * to audit, so neither its declaration nor its silence is meaningful here) —
 * this is why a pure-planning task cannot drag a fully-declared plan into
 * `scope_undeclared: true`.
 *
 * @param tasks - The plan's task (or phase) documents, as resolved by the caller
 *   (`CorpusService.getPlanBundle`) — the ONLY source of `extra.ac_scope`, which
 *   is why the gate predicate takes this fact precomputed rather than deriving it
 *   (module invariant: predicates see no documents, this module sees no store).
 * @param coverage - {@link computeAcCoverage}'s output over the plan's governing
 *   spec's declared criteria; supplies both the declarable id set (its
 *   script-mode rows) and each id's attestation counts. `[]` for a plan with no
 *   spec-tier ancestor — nothing is declarable, so `declared_acs` is empty and
 *   the conjunct is vacuously satisfied.
 * @returns The declared union, its unattested subset, whether any
 *   evidence-bearing task left its scope undeclared, and whether the conjunct is
 *   satisfied. Never throws.
 * @example
 * // one task declaring AC-1 (attested) — a satisfied, resolved declaration
 * deriveDeclaredScopeCoverage(
 *   [{ extra: { ac_scope: ["AC-1"], verification_evidence: [attestedEntry] } } as DocRecord],
 *   [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [{task_id: "t", result: "pass", attested: true}], attested_pass: 1, attested_fail: 0 }],
 * );
 * // => { declared_acs: ["AC-1"], unattested_acs: [], scope_undeclared: false, meets_coverage: true }
 * @example
 * // the legacy shape: evidence, no declaration — the two facts DISAGREE (AC-VS-6)
 * deriveDeclaredScopeCoverage(
 *   [{ extra: { verification_evidence: [attestedEntry] } } as DocRecord],
 *   [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [{task_id: "t", result: "pass", attested: true}], attested_pass: 1, attested_fail: 0 }],
 * );
 * // => { declared_acs: [], unattested_acs: [], scope_undeclared: true, meets_coverage: true }
 */
export function deriveDeclaredScopeCoverage(
  tasks: readonly DocRecord[],
  coverage: readonly AcCoverageFact[],
): DeclaredScopeCoverage {
  const declarableIds = new Set(
    coverage.filter((fact) => fact.mode === "script").map((fact) => fact.ac_id),
  );
  const declaredIds = new Set<string>();
  let scopeUndeclared = false;
  for (const task of tasks) {
    if (extractEvidence(task).length === 0) continue;
    const scope = findDeclaredAcScope(task);
    if (scope === undefined) {
      scopeUndeclared = true;
      continue;
    }
    for (const id of scope) {
      if (declarableIds.has(id)) declaredIds.add(id);
    }
  }
  // reason: iterate `coverage` (not `declaredIds`) so both arrays come out in
  // DECLARATION order — a Set preserves INSERTION order, which here would be
  // task order and would make the fact's rendering depend on how the store
  // happened to return the plan's tasks.
  const declared = coverage.filter((fact) => declaredIds.has(fact.ac_id));
  const unattested_acs = declared
    .filter((fact) => fact.attested_pass + fact.attested_fail === 0)
    .map((fact) => fact.ac_id);
  return {
    declared_acs: declared.map((fact) => fact.ac_id),
    unattested_acs,
    scope_undeclared: scopeUndeclared,
    meets_coverage: unattested_acs.length === 0,
  };
}

/**
 * Maps a {@link DeclaredScopeCoverage} fact to the plan-close coverage
 * conjunct's verdict.
 *
 * Precedence is FAIL > NOT-APPLICABLE > PASS, and the order matters: a plan
 * where task A declares an unattested AC while task B declares nothing has BOTH
 * a measured violation and an undeclared task. Reporting "inapplicable" there
 * would erase A's real violation, so the measured failure is checked FIRST. Do
 * not reorder these two branches.
 *
 * @param coverage - The declared-scope fact, from
 *   {@link deriveDeclaredScopeCoverage} (or {@link UNRESOLVED_DECLARED_SCOPE}
 *   when the caller never resolved it).
 * @param referent - The closing plan's slug or id — carried on the
 *   not-applicable verdict for the advisory/audit channels
 *   (`GateEnforcer.enforce`), ignored on the other two.
 * @returns `{ok: false, unattested_acs}` when some declared AC has zero attested
 *   evidence; `{notApplicable: true, reason: "scope-undeclared", referent}` when
 *   no violation is measurable because an evidence-bearing task declared no
 *   scope; `{ok: true}` otherwise. NEVER `{ok: true}` for an undeclared scope —
 *   that vacuous pass is the defect the governing spec removes.
 * @example
 * declaredScopeCoverageVerdict(UNRESOLVED_DECLARED_SCOPE, "plan-x");
 * // => { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" }
 */
export function declaredScopeCoverageVerdict(
  coverage: DeclaredScopeCoverage,
  referent: string,
): DeclaredScopeCoverageVerdict {
  if (!coverage.meets_coverage) return { ok: false, unattested_acs: coverage.unattested_acs };
  if (coverage.scope_undeclared) {
    return { notApplicable: true, reason: SCOPE_UNDECLARED_REASON, referent };
  }
  return { ok: true };
}

// ─── Attestation Ratio Math ─────────────────────────────────────────────────

/**
 * Renderable plan-wide attestation facts, expressed as data rather than a bare
 * pass/fail verdict so the dashboard Evidence tab can show WHY a plan is
 * blocked, not just THAT it is.
 *
 * Every field here is evidence-derived. `meets_floor` therefore carries only the
 * conjunct that evidence facts can decide (the opt-in ratio) — the plan-close
 * gate ANDs it with the DECLARED-scope conjunct, whose input
 * ({@link DeclaredScopeCoverage}) needs each task's `extra.ac_scope`, a document
 * fact `TaskAttestationInfo` deliberately does not carry. A consumer rendering a
 * plan's gate verdict must combine both facts; `meets_floor` alone is NOT the
 * gate verdict (see {@link deriveAttestationSummary}).
 */
export interface AttestationSummary {
  /** Sum of `evidenceCount` across every input task. */
  total_evidence: number;
  /** Sum of `attestedCount` across every input task. */
  attested: number;
  /**
   * `attested / total_evidence`, or `null` when `total_evidence === 0` — NEVER a
   * fabricated `0` for the vacuous-pass case (no evidence anywhere means no
   * meaningful ratio, not a 0% ratio).
   */
  ratio: number | null;
  /**
   * The configured floor this summary was evaluated against, or `null` when
   * `workflow.attestation.min_ratio` is UNCONFIGURED (spec-plan-close-
   * predicates-measure-invariants-an-applicability §D4 — the ratio conjunct's
   * default flipped to off). `null` means condition 3 (the ratio check) never
   * runs at all — never coerce this to `0` or `0.5` at a render site.
   */
  min_ratio: number | null;
  /**
   * The EXERCISED-AC coverage facts — REPORTED, never gated on
   * (spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts D4; the
   * field keeps its `claimed_ac_coverage` name because the dashboard's
   * `PlanAttestationPanel` reads it by that key). The gating counterpart is
   * {@link DeclaredScopeCoverage}.
   */
  claimed_ac_coverage: ClaimedAcCoverage;
  /**
   * `true` when the RATIO conjunct clears: `min_ratio === null` (unconfigured, so
   * it never runs) OR `ratio >= min_ratio` — or the vacuous-pass case,
   * `total_evidence === 0`, which is always `true`.
   *
   * NOT the plan-close verdict on its own: the per-task zero-attested condition
   * was DEMOTED to the reported `zero_attested_tasks` fact (§Facts D5) and the
   * coverage conjunct now reads {@link DeclaredScopeCoverage}, which this
   * function cannot see. Re-ANDing either of those back in here would restore a
   * verdict that disagrees with the gate.
   */
  meets_floor: boolean;
  /**
   * Slugs of every task carrying evidence but zero attested entries — the
   * DEMOTED condition 1 (§Facts D5): still computed and reported for
   * diagnostics/rendering, no longer part of `meets_floor`. Deleting this
   * computation would lose the feeding pack's per-task diagnostics.
   */
  zero_attested_tasks: string[];
}

/**
 * Derives the plan-wide evidence facts and the ONE conjunct they can decide, as
 * a renderable {@link AttestationSummary}.
 *
 * `attestationFloor`'s three historical conditions now land in three different
 * places (spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts,
 * superseding spec-plan-close-predicates-measure-invariants-an-applicability §D3
 * and SPEC-069 §Design Decisions D1):
 *
 *   1. "every evidence-bearing task carries >= 1 attested entry" — DEMOTED to a
 *      REPORTED fact (§Facts D5): still computed here as
 *      `zero_attested_tasks`, no longer part of `meets_floor`. It blocked on a
 *      per-task PROXY: a task can legitimately hold self-reported-only evidence
 *      (a RED/TDD run) while every criterion the plan DECLARED is attested
 *      elsewhere;
 *   2. per-AC attested coverage — still gated, but over the DECLARED set
 *      ({@link deriveDeclaredScopeCoverage} + {@link declaredScopeCoverageVerdict},
 *      §Facts D4), NOT over `claimed_ac_coverage`, which is evidence-derived and
 *      would let the audited evidence define its own audit scope;
 *   3. the plan-wide attested-evidence ratio (total attested / total evidence)
 *      must be >= `minRatio` — OPT-IN: evaluated only when `minRatio` is
 *      non-`null`. This is the ONLY conjunct `meets_floor` still carries.
 *
 * A plan with NO evidence at all on any task (`total_evidence === 0`) is a
 * vacuous PASS (`meets_floor: true`, `ratio: null`) — the "pure-planning plan"
 * carve-out (SPEC-069 §Scope): the floor only constrains a plan that claims to
 * have been verified, never one that never ran any oracle at all. This early
 * return still reports the REAL `claimed_ac_coverage` facts (this function
 * never fabricates data); `gate-predicates.ts::attestationFloor` reports the
 * zero-evidence case as NOT-APPLICABLE regardless of `meets_floor`'s value here.
 *
 * @param infos - Every task's (or phase's) attestation facts, typically
 *   {@link buildTaskAttestationInfos}'s output. An empty array is treated
 *   identically to the vacuous-pass case.
 * @param minRatio - The configured floor (`workflow.attestation.min_ratio`), or
 *   `null` when unconfigured — `null` means condition 3 never runs at all.
 * @param acCoverage - {@link computeAcCoverage}'s own output (the plan's
 *   governing spec's declared criteria aggregated over the plan's tasks) —
 *   REQUIRED (not optional): an optional parameter here would let a caller
 *   silently drop the exercised-coverage facts from a rendered panel. Pass `[]`
 *   for a caller with no spec-tier ancestor to resolve criteria from.
 * @returns The facts object. `meets_floor` is the RATIO conjunct only — a caller
 *   needing the plan-close verdict must AND it with
 *   {@link declaredScopeCoverageVerdict} over the plan's declared scope.
 * @example
 * deriveAttestationSummary(
 *   [{ slug: "task-1", title: "T1", evidenceCount: 3, attestedCount: 0 }],
 *   0.5,
 *   [],
 * );
 * // => { total_evidence: 3, attested: 0, ratio: 0, min_ratio: 0.5,
 * //      claimed_ac_coverage: { exercised_acs: [], unattested_acs: [], meets_coverage: true },
 * //      meets_floor: false, zero_attested_tasks: ["task-1"] }
 * //    (meets_floor false via the RATIO 0 < 0.5, not via zero_attested_tasks)
 * @example
 * deriveAttestationSummary([], 0.5, []);
 * // => { total_evidence: 0, attested: 0, ratio: null, min_ratio: 0.5,
 * //      claimed_ac_coverage: { exercised_acs: [], unattested_acs: [], meets_coverage: true },
 * //      meets_floor: true, zero_attested_tasks: [] } — vacuous pass
 * @example
 * deriveAttestationSummary(
 *   [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 1 }],
 *   null,
 *   [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [{task_id: "task-1", result: "pass"}], attested_pass: 0, attested_fail: 0 }],
 * );
 * // => meets_floor: true — the ratio conjunct is disabled (minRatio null) and
 * //    AC-1's unattested EXERCISED evidence is reported, never gated on; the
 * //    declared-scope conjunct is what decides this plan's close.
 */
export function deriveAttestationSummary(
  infos: readonly TaskAttestationInfo[],
  minRatio: number | null,
  acCoverage: readonly AcCoverageFact[],
): AttestationSummary {
  const totalEvidence = infos.reduce((sum, t) => sum + t.evidenceCount, 0);
  const attested = infos.reduce((sum, t) => sum + t.attestedCount, 0);
  const zeroAttestedTasks = infos
    .filter((t) => t.evidenceCount > 0 && t.attestedCount === 0)
    .map((t) => t.slug);
  const claimedAcCoverage = deriveClaimedAcCoverage(acCoverage);

  if (totalEvidence === 0) {
    return {
      total_evidence: 0,
      attested: 0,
      ratio: null,
      min_ratio: minRatio,
      claimed_ac_coverage: claimedAcCoverage,
      meets_floor: true,
      zero_attested_tasks: [],
    };
  }

  const ratio = attested / totalEvidence;
  // reason: the RATIO conjunct alone (spec-declared-scope-attestation-contract-
  // task-owned-ac-scope §Facts D4/D5). `zeroAttestedTasks.length === 0` was
  // demoted to a reported fact and `claimedAcCoverage.meets_coverage` is
  // evidence-derived — AND-ing either back in would (a) resurrect a per-task
  // proxy this spec deliberately removed and (b) make this value disagree with
  // `attestationFloor`, whose coverage conjunct reads the DECLARED scope.
  const meetsFloor = minRatio === null || ratio >= minRatio;
  return {
    total_evidence: totalEvidence,
    attested,
    ratio,
    min_ratio: minRatio,
    claimed_ac_coverage: claimedAcCoverage,
    meets_floor: meetsFloor,
    zero_attested_tasks: zeroAttestedTasks,
  };
}

// ─── Evidence Panel Projection ──────────────────────────────────────────────

/** Evidence-tab projection for a `task` doc — its raw evidence log + declared AC refs. */
export interface TaskEvidencePanel {
  doc_type: "task";
  evidence: EvidenceEntry[];
  ac_refs: string[];
}

/** Evidence-tab projection for a `spec` doc — its declared ACs + aggregated coverage. */
export interface SpecEvidencePanel {
  doc_type: "spec";
  criteria: AcceptanceCriterion[];
  coverage: AcCoverageFact[];
  task_count: number;
}

/**
 * Evidence-tab projection for a `plan` doc — plan-wide attestation + per-task
 * facts, PLUS the declared-scope coverage conjunct (task-meets-floor-renders-
 * pass-while-the-declared-scope-conjunct). `attestation.meets_floor` carries
 * ONLY the opt-in ratio conjunct (see {@link AttestationSummary.meets_floor}'s
 * own doc comment); the `plan-close` gate's actual verdict ANDs that with the
 * DECLARED-scope conjunct ({@link declaredScopeCoverageVerdict}, the SAME
 * function `gate-predicates.ts::attestationFloor` calls). This projection
 * carries both facts so a rendering consumer can never show a "meets floor"
 * badge while the gate denies on undeclared/unattested scope.
 */
export interface PlanEvidencePanel {
  doc_type: "plan";
  attestation: AttestationSummary;
  tasks: TaskAttestationInfo[];
  /**
   * The DECLARED-scope coverage fact ({@link deriveDeclaredScopeCoverage}'s own
   * output) — the plan-close coverage conjunct's input. Carried alongside
   * {@link PlanEvidencePanel.declared_scope_verdict} (not only the verdict) so
   * a rendering consumer can list which ids are declared/unattested, mirroring
   * `attestation.claimed_ac_coverage`'s own "fact + list" shape.
   */
  declared_scope_coverage: DeclaredScopeCoverage;
  /**
   * {@link declaredScopeCoverageVerdict}'s three-valued verdict over
   * `declared_scope_coverage` — `{ok: true}`, `{ok: false, unattested_acs}`, or
   * `{notApplicable: true, reason: "scope-undeclared", referent}`. A rendering
   * consumer MUST branch on all three (never collapse `notApplicable` into
   * either pass or fail) — that collapse is exactly the proxy-for-invariant
   * defect this field exists to remove.
   */
  declared_scope_verdict: DeclaredScopeCoverageVerdict;
}

/** Evidence-tab projection for every other doc type (prd/adr/knowledge/phase) — no evidence surface. */
export interface OtherEvidencePanel {
  doc_type: "other";
}

/**
 * The dashboard Evidence tab's per-doc-type projection — a discriminated union
 * (tag: `doc_type`) so a rendering consumer can `switch` on it exhaustively
 * without a runtime type-check against `DocRecord.type` (SPEC-075 D2). Assembly
 * (which fields populate which branch, from which store reads) is T2's
 * `VerificationProjectionService` scope, not this module's — this file only
 * defines the shape and the pure math two of its branches (`spec`/`plan`) need.
 */
export type EvidencePanelProjection =
  | TaskEvidencePanel
  | SpecEvidencePanel
  | PlanEvidencePanel
  | OtherEvidencePanel;

// ─── Adjudication Bar Summary ───────────────────────────────────────────────

/**
 * Compact chip-summary counts + a single fail-first status verdict, derived from
 * an {@link EvidencePanelProjection} — the shape the AdjudicationBar UI
 * component renders. Kept deliberately small and doc-type-agnostic on its output
 * side (a caller doesn't need to re-branch on `doc_type` to render a status chip).
 */
export interface AdjudicationBarSummary {
  doc_type: EvidencePanelProjection["doc_type"];
  evidence_count: number;
  attested_count: number;
  pass_count: number;
  fail_count: number;
  /**
   * `task`/`spec`/`other`: fail-first — any fail wins over any pass; no
   * evidence at all is `"none"`.
   *
   * `plan`: no evidence at all is `"none"` (the vacuous-pass case, unchanged);
   * otherwise this is {@link derivePlanCloseChipStatus}'s three-valued verdict
   * over `attestation.meets_floor` (the RATIO conjunct alone) AND
   * `declared_scope_verdict` (the DECLARED-scope conjunct) — `"scope-undeclared"`
   * is reachable ONLY here, and ONLY for `doc_type: "plan"`
   * (task-adjudicationbar-s-compact-status-chip-still-derives-from). It must
   * never collapse into `"pass"` (the exact defect this fix removes) nor into
   * `"fail"` (an escalation this function does not attempt — see
   * {@link derivePlanCloseChipStatus}'s own doc comment).
   */
  status: "pass" | "fail" | "none" | "scope-undeclared";
}

/**
 * The precedence combinator behind `summarizeForAdjudicationBar`'s `plan`
 * branch status (task-adjudicationbar-s-compact-status-chip-still-derives-from)
 * — the SAME rule the dashboard's `PlanAttestationPanel.tsx::
 * derivePlanAttestationBadgeState` applies over the SAME two facts, so the
 * compact chip and the full attestation panel badge can never again disagree
 * about which of the three states a plan is in.
 *
 * NOT a ratio/coverage re-derivation — both inputs are ALREADY-resolved facts
 * (`AttestationSummary.meets_floor`, `declaredScopeCoverageVerdict`'s output);
 * this is a precedence PICK over two enums, nothing more.
 *
 * Precedence is FAIL > NOT-APPLICABLE > PASS (mirrors
 * `declaredScopeCoverageVerdict`'s own ordering, and
 * `derivePlanAttestationBadgeState`'s): a measured failure on EITHER conjunct
 * outranks the undeclared-scope not-applicable, which outranks a pass. An
 * undeclared scope must never mask a genuinely failing ratio, and a passing
 * ratio must never paper over an undeclared scope — `"scope-undeclared"` is a
 * GENUINELY THIRD state, never collapsed into `"pass"` (the bug this function
 * exists to remove) nor into `"fail"` (an escalation this function does not
 * attempt: that would need a THIRD fact — whether the spec declares any
 * script-mode AC at all — neither this function nor its panel-side sibling has).
 *
 * @param meetsFloor - `AttestationSummary.meets_floor` — the RATIO conjunct alone.
 * @param declaredScopeVerdict - `declaredScopeCoverageVerdict`'s verdict over
 *   the plan's `DeclaredScopeCoverage` (`PlanEvidencePanel.declared_scope_verdict`).
 * @returns `"fail"` when either conjunct measurably fails, `"scope-undeclared"`
 *   when neither measurably fails but the declared-scope conjunct is
 *   not-applicable, `"pass"` when both conjuncts pass.
 * @example
 * derivePlanCloseChipStatus(true, { ok: true }); // => "pass"
 * @example
 * derivePlanCloseChipStatus(true, { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" });
 * // => "scope-undeclared" — NEVER "pass"
 * @example
 * derivePlanCloseChipStatus(false, { ok: true }); // => "fail"
 * @example
 * derivePlanCloseChipStatus(true, { ok: false, unattested_acs: ["AC-1"] }); // => "fail"
 */
export function derivePlanCloseChipStatus(
  meetsFloor: boolean,
  declaredScopeVerdict: DeclaredScopeCoverageVerdict,
): "pass" | "fail" | "scope-undeclared" {
  if (!meetsFloor) return "fail";
  if ("ok" in declaredScopeVerdict && !declaredScopeVerdict.ok) return "fail";
  if (!("ok" in declaredScopeVerdict)) return "scope-undeclared";
  return "pass";
}

/**
 * Reduces an {@link EvidencePanelProjection} to a compact {@link AdjudicationBarSummary}.
 * Fail-first precedence (mirrors `acceptance.ts::deriveAcCoverageState`'s "a fail
 * always wins over any pass" rule) for `task`/`spec`/`other`: any failing
 * evidence/coverage makes the status `"fail"`, regardless of how much
 * passing/attested evidence also exists. For `plan`, status instead comes from
 * {@link derivePlanCloseChipStatus} (never `meets_floor` alone —
 * task-adjudicationbar-s-compact-status-chip-still-derives-from), preserving
 * the pre-existing `"none"` vacuous-pass rendering when there is no evidence
 * at all.
 *
 * @example
 * summarizeForAdjudicationBar({ doc_type: "other" });
 * // => { doc_type: "other", evidence_count: 0, attested_count: 0, pass_count: 0,
 * //      fail_count: 0, status: "none" }
 */
export function summarizeForAdjudicationBar(panel: EvidencePanelProjection): AdjudicationBarSummary {
  switch (panel.doc_type) {
    case "task": {
      const passCount = panel.evidence.filter((e) => e.result === "pass").length;
      const failCount = panel.evidence.filter((e) => e.result === "fail").length;
      const attestedCount = panel.evidence.filter((e) => e.attestation !== undefined).length;
      return {
        doc_type: "task",
        evidence_count: panel.evidence.length,
        attested_count: attestedCount,
        pass_count: passCount,
        fail_count: failCount,
        status: failCount > 0 ? "fail" : passCount > 0 ? "pass" : "none",
      };
    }
    case "spec": {
      const passCount = panel.coverage.reduce((sum, fact) => sum + fact.pass, 0);
      const failCount = panel.coverage.reduce((sum, fact) => sum + fact.fail, 0);
      const attestedCount = panel.coverage.reduce(
        (sum, fact) => sum + fact.attested_pass + fact.attested_fail,
        0,
      );
      return {
        doc_type: "spec",
        evidence_count: passCount + failCount,
        attested_count: attestedCount,
        pass_count: passCount,
        fail_count: failCount,
        status: failCount > 0 ? "fail" : passCount > 0 ? "pass" : "none",
      };
    }
    case "plan": {
      const { total_evidence, attested, meets_floor } = panel.attestation;
      // reason: total_evidence === 0 stays the pre-existing vacuous-pass "none"
      // render regardless of the declared-scope verdict — a plan with literally
      // no evidence has no evidence-bearing task to consult, so
      // deriveDeclaredScopeCoverage never marks it scope-undeclared either;
      // collapsing this case into derivePlanCloseChipStatus's "pass" would
      // misleadingly claim something was verified (task-adjudicationbar-s-
      // compact-status-chip-still-derives-from, REGRESSION coverage).
      const status =
        total_evidence === 0 ? "none" : derivePlanCloseChipStatus(meets_floor, panel.declared_scope_verdict);
      return {
        doc_type: "plan",
        evidence_count: total_evidence,
        attested_count: attested,
        pass_count: 0,
        fail_count: 0,
        status,
      };
    }
    case "other":
      return {
        doc_type: "other",
        evidence_count: 0,
        attested_count: 0,
        pass_count: 0,
        fail_count: 0,
        status: "none",
      };
  }
}
