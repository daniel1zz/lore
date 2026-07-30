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
 *   - deriveAttestationSummary(infos, minRatio, acCoverage) — reproduces ALL
 *     THREE of `attestationFloor`'s conditions (per-task zero-attested AND
 *     per-claimed-AC attested coverage AND an OPT-IN plan-wide ratio floor) as
 *     a renderable fact object, rather than a bare pass/fail predicate result.
 *     `gate-predicates.ts::attestationFloor` now delegates to this function —
 *     byte-identical gate behavior (AC-075-11, extended by
 *     spec-plan-close-predicates-measure-invariants-an-applicability §D3/D4).
 *   - deriveClaimedAcCoverage(coverage) — the per-claimed-AC attested-coverage
 *     fact (§D3's "condition 2, the default teeth"): which declared script-mode
 *     acceptance criteria were actually CLAIMED (>=1 evidence reference) by this
 *     plan's tasks, and which of those remain unattested.
 *   - summarizeForAdjudicationBar(panel) — compact chip-summary projection shared by
 *     the (not-yet-built, T3-scope) AdjudicationBar UI component.
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
 *
 * Side-effect class: pure
 *
 * Source: SPEC-075 (dashboard adjudication workbench + route telemetry) §Design
 *   Decisions D2, D6, D10; SPEC-069 §Design Decisions D1 (attestationFloor, the
 *   predicate this module's math must stay byte-identical to);
 *   spec-plan-close-predicates-measure-invariants-an-applicability §D3
 *   (per-claimed-AC coverage as the default conjunct), §D4 (ratio default flip).
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

// ─── Per-Claimed-AC Attested Coverage (spec-plan-close-predicates-measure- ──
// ─── invariants-an-applicability §D3) ───────────────────────────────────────

/**
 * Per-claimed-AC attested-coverage facts — the "default teeth" conjunct
 * (§D3 condition 2) that replaces a plan-wide evidence ratio as the primary
 * signal: not "how much of this plan's evidence is attested" but "was EVERY
 * acceptance criterion this plan actually claimed ever runner-attested".
 */
export interface ClaimedAcCoverage {
  /**
   * Declared script-mode criteria carrying >= 1 evidence reference, in
   * declaration order (the order {@link computeAcCoverage}'s own output
   * preserves). `ai`/`human`-mode criteria are excluded — `lore verify`
   * structurally cannot attest them, so demanding their attestation would be
   * a permanent false block (§D3(b)). A dangling `ac_ref` naming an
   * undeclared id can never appear here — {@link computeAcCoverage} emits one
   * row per DECLARED criterion only, so this array's input already excludes
   * dangling refs structurally (see this module's header invariant).
   */
  claimed_acs: string[];
  /**
   * Subset of `claimed_acs` whose evidence carries ZERO runner attestation
   * (`attested_pass + attested_fail === 0` — never `attested_pass` alone, per
   * the spec's pinned counting rule: a runner-issued fail still proves the
   * runner ran that AC's registered command).
   */
  unattested_acs: string[];
  /** `unattested_acs.length === 0` — vacuously `true` when `claimed_acs` is empty. */
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
 * @returns The claimed set (script-mode, >=1 ref), its unattested subset, and
 *   whether every claimed criterion is attested. `{claimed_acs: [],
 *   unattested_acs: [], meets_coverage: true}` for an empty `coverage` input —
 *   a plan/spec pairing with nothing claimed has nothing to fail on.
 * @example
 * deriveClaimedAcCoverage([
 *   { ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [{task_id: "t", result: "pass", attested: true}], attested_pass: 1, attested_fail: 0 },
 *   { ac_id: "AC-2", mode: "script", pass: 1, fail: 0, refs: [{task_id: "t", result: "pass"}], attested_pass: 0, attested_fail: 0 },
 *   { ac_id: "AC-3", mode: "human", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0 },
 * ]);
 * // => { claimed_acs: ["AC-1", "AC-2"], unattested_acs: ["AC-2"], meets_coverage: false }
 * // (AC-3 excluded: human-mode; AC-3 also carries zero refs, so it would be
 * //  excluded on that ground alone even if it were script-mode)
 */
export function deriveClaimedAcCoverage(coverage: readonly AcCoverageFact[]): ClaimedAcCoverage {
  const claimed = coverage.filter((fact) => fact.mode === "script" && fact.refs.length > 0);
  const claimed_acs = claimed.map((fact) => fact.ac_id);
  const unattested_acs = claimed
    .filter((fact) => fact.attested_pass + fact.attested_fail === 0)
    .map((fact) => fact.ac_id);
  return { claimed_acs, unattested_acs, meets_coverage: unattested_acs.length === 0 };
}

// ─── Attestation Ratio Math ─────────────────────────────────────────────────

/**
 * Renderable plan-wide attestation facts — the same conditions
 * `gate-predicates.ts::attestationFloor` gates on (SPEC-069's per-task
 * zero-attested check, plus spec-plan-close-predicates-measure-invariants-an-
 * applicability §D3's per-claimed-AC coverage and opt-in ratio), expressed as
 * data rather than a bare pass/fail verdict, so the dashboard Evidence tab can
 * show WHY a plan is blocked, not just THAT it is.
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
  /** The per-claimed-AC attested-coverage facts (§D3 condition 2, the default teeth). */
  claimed_ac_coverage: ClaimedAcCoverage;
  /**
   * `true` when EVERY applicable condition clears: no evidence-bearing task has
   * zero attested entries, AND `claimed_ac_coverage.meets_coverage`, AND
   * (`min_ratio === null` OR `ratio >= min_ratio`) — or the vacuous-pass case,
   * `total_evidence === 0`, which is always `true` regardless of the other two.
   */
  meets_floor: boolean;
  /** Slugs of every task carrying evidence but zero attested entries. */
  zero_attested_tasks: string[];
}

/**
 * Reproduces ALL THREE of `attestationFloor`'s conditions
 * (spec-plan-close-predicates-measure-invariants-an-applicability §D3, extending
 * SPEC-069 §Design Decisions D1) as a renderable {@link AttestationSummary} fact
 * object:
 *
 *   1. every task that carries ANY `verification_evidence` must carry at least
 *      one runner-issued (attested) entry — a task with N self-reported entries
 *      and ZERO attested ones is undetectable fabrication risk, even if the
 *      plan-wide ratio is otherwise healthy;
 *   2. every CLAIMED-AND-ATTESTABLE acceptance criterion (`acCoverage`'s own
 *      `deriveClaimedAcCoverage` projection) must carry >= 1 runner-attested
 *      entry — the DEFAULT conjunct (§D3, "the default teeth");
 *   3. the plan-wide attested-evidence ratio (total attested / total evidence,
 *      across every task) must be >= `minRatio` — OPT-IN: only evaluated when
 *      `minRatio` is non-`null` (§D4's default-off migration). An explicitly
 *      configured floor is AND-ed with conditions 1-2, never a substitute for
 *      them.
 *
 * A plan with NO evidence at all on any task (`total_evidence === 0`) is a
 * vacuous PASS (`meets_floor: true`, `ratio: null`) — the "pure-planning plan"
 * carve-out (SPEC-069 §Scope): the floor only constrains a plan that claims to
 * have been verified, never one that never ran any oracle at all. This early
 * return still reports the REAL `claimed_ac_coverage` facts (this function
 * never fabricates data), it simply never lets them affect `meets_floor` here —
 * `gate-predicates.ts::attestationFloor` reports the zero-evidence case as
 * NOT-APPLICABLE regardless of what this function's `meets_floor` says.
 *
 * `gate-predicates.ts::attestationFloor` delegates to this function — its
 * `{ok: false}` case fires exactly when `meets_floor` here is `false`
 * (AC-075-11 byte-identical-gate-behavior parity, extended by AC-PCI-6).
 *
 * @param infos - Every task's (or phase's) attestation facts, typically
 *   {@link buildTaskAttestationInfos}'s output. An empty array is treated
 *   identically to the vacuous-pass case.
 * @param minRatio - The configured floor (`workflow.attestation.min_ratio`), or
 *   `null` when unconfigured — `null` means condition 3 never runs at all.
 * @param acCoverage - {@link computeAcCoverage}'s own output (the plan's
 *   governing spec's declared criteria aggregated over the plan's tasks) —
 *   REQUIRED (not optional): an optional parameter here would let a caller
 *   silently opt out of the coverage conjunct, exactly the failure mode this
 *   spec closes. Pass `[]` for a caller with no spec-tier ancestor to resolve
 *   criteria from (vacuously `meets_coverage: true`, never a fabricated block).
 * @example
 * deriveAttestationSummary(
 *   [{ slug: "task-1", title: "T1", evidenceCount: 3, attestedCount: 0 }],
 *   0.5,
 *   [],
 * );
 * // => { total_evidence: 3, attested: 0, ratio: 0, min_ratio: 0.5,
 * //      claimed_ac_coverage: { claimed_acs: [], unattested_acs: [], meets_coverage: true },
 * //      meets_floor: false, zero_attested_tasks: ["task-1"] }
 * @example
 * deriveAttestationSummary([], 0.5, []);
 * // => { total_evidence: 0, attested: 0, ratio: null, min_ratio: 0.5,
 * //      claimed_ac_coverage: { claimed_acs: [], unattested_acs: [], meets_coverage: true },
 * //      meets_floor: true, zero_attested_tasks: [] } — vacuous pass
 * @example
 * deriveAttestationSummary(
 *   [{ slug: "task-1", title: "T1", evidenceCount: 2, attestedCount: 1 }],
 *   null,
 *   [{ ac_id: "AC-1", mode: "script", pass: 1, fail: 0, refs: [{task_id: "task-1", result: "pass"}], attested_pass: 0, attested_fail: 0 }],
 * );
 * // => meets_floor: false — AC-1 was claimed (>=1 ref) but never attested,
 * //    even though the ratio conjunct is disabled (minRatio: null)
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
  const meetsFloor =
    zeroAttestedTasks.length === 0 &&
    claimedAcCoverage.meets_coverage &&
    (minRatio === null || ratio >= minRatio);
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

/** Evidence-tab projection for a `plan` doc — plan-wide attestation + per-task facts. */
export interface PlanEvidencePanel {
  doc_type: "plan";
  attestation: AttestationSummary;
  tasks: TaskAttestationInfo[];
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
 * an {@link EvidencePanelProjection} — the shape the (T3-scope) AdjudicationBar UI
 * component renders. Kept deliberately small and doc-type-agnostic on its output
 * side (a caller doesn't need to re-branch on `doc_type` to render a status chip).
 */
export interface AdjudicationBarSummary {
  doc_type: EvidencePanelProjection["doc_type"];
  evidence_count: number;
  attested_count: number;
  pass_count: number;
  fail_count: number;
  /** Fail-first: any fail wins over any pass; no evidence at all is `"none"`. */
  status: "pass" | "fail" | "none";
}

/**
 * Reduces an {@link EvidencePanelProjection} to a compact {@link AdjudicationBarSummary}.
 * Fail-first precedence (mirrors `acceptance.ts::deriveAcCoverageState`'s "a fail
 * always wins over any pass" rule): any failing evidence/coverage makes the status
 * `"fail"`, regardless of how much passing/attested evidence also exists.
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
      return {
        doc_type: "plan",
        evidence_count: total_evidence,
        attested_count: attested,
        pass_count: 0,
        fail_count: 0,
        status: total_evidence === 0 ? "none" : meets_floor ? "pass" : "fail",
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
