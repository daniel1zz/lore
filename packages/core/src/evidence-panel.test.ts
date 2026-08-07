/**
 * Tests for @lore/core evidence-panel — buildTaskAttestationInfos,
 * deriveAttestationSummary, deriveClaimedAcCoverage, deriveDeclaredScopeCoverage,
 * declaredScopeCoverageVerdict, derivePlanCloseChipStatus, EvidencePanelProjection,
 * summarizeForAdjudicationBar. Pure functions, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      buildTaskAttestationInfos derives evidenceCount/attestedCount per
 *               task; deriveAttestationSummary aggregates a mixed fully-attested
 *               set to meets_floor:true; deriveClaimedAcCoverage derives the
 *               exercised script-mode set (AC-PCI-5); deriveDeclaredScopeCoverage
 *               resolves a declared+attested scope to an ok verdict (AC-VS-6
 *               control); summarizeForAdjudicationBar reduces every
 *               EvidencePanelProjection branch to the expected chip summary,
 *               including a task/spec panel whose only evidence is
 *               expected-fail/inconclusive reducing to that SAME status (never
 *               "none" — task-two-more-evidence-consumers-erase-an-expected-
 *               fail-row-doc); derivePlanCloseChipStatus resolves both conjuncts
 *               passing to "pass"
 *   NEGATIVE:   a task with malformed extra.verification_evidence (non-array) does
 *               not throw and contributes zero counts (extractEvidence's own
 *               fail-closed behavior); an ai-mode/human-mode criterion with refs
 *               is excluded from the exercised set (AC-PCI-5); a DECLARED AC with
 *               zero attested refs fails the coverage conjunct even when another
 *               evidence-bearing task declared nothing (AC-VS-6, fail outranks
 *               not-applicable); derivePlanCloseChipStatus returns "fail" for a
 *               measurably-failing declared-scope conjunct even when the ratio
 *               conjunct alone passes
 *   BOUNDARY:   empty tasks array; ratio exactly equal to minRatio passes
 *               (`>=` not `>`); a single task with zero evidence entries; an empty
 *               coverage input yields a vacuously true exercised-AC coverage; an
 *               EMPTY ac_scope is a declaration while an ABSENT one is not; a
 *               task with no evidence is never consulted for a declaration;
 *               declared ids outside the spec's script-mode set intersect away
 *               (AC-VS-6); derivePlanCloseChipStatus returns "scope-undeclared"
 *               (never "pass") for a not-applicable declared-scope verdict, and a
 *               failing ratio wins precedence over an undeclared scope
 *   ERROR:      a malformed ac_scope (non-array / non-string member) is reported AS
 *               undeclared and never throws (AC-VS-6) — every other public
 *               function here is total by construction
 *   STATE:      zero_attested_tasks accumulates every offending task's slug (not
 *               just the first); a below-floor ratio blocks even when EVERY task
 *               individually carries >=1 attested entry; the exercised and declared
 *               facts DISAGREE on a fixture with evidence but no declaration, and
 *               the coverage conjunct returns notApplicable(scope-undeclared)
 *               (AC-VS-6); the declared union spans tasks in declaration order
 *   REGRESSION: deriveAttestationSummary's vacuous-pass branch (total_evidence===0)
 *               yields ratio:null (never a fabricated 0) and meets_floor:true;
 *               the DEMOTED per-task zero-attested condition (§Facts D5) and the
 *               RETIRED exercised-coverage conjunct (§Facts D4) are reported but
 *               no longer lower meets_floor — inverted here in the same slice that
 *               changed the behavior, superseding AC-075-11 condition 1 and
 *               AC-PCI-6; UNRESOLVED_DECLARED_SCOPE can never fabricate a
 *               compliant declaration; summarizeForAdjudicationBar's plan branch
 *               still reduces a zero-evidence plan to "none" (never "pass" or
 *               "scope-undeclared") regardless of the declared-scope verdict
 *               (task-adjudicationbar-s-compact-status-chip-still-derives-from);
 *               pass_count/fail_count are UNCHANGED for pass/fail-only panels
 *               after the expected-fail/inconclusive fix (task-two-more-
 *               evidence-consumers-erase-an-expected-fail-row-doc)
 *   CONTROL:    (task-two-more-evidence-consumers-erase-an-expected-fail-row-doc)
 *               a task panel with only a pass row, only an expected-fail row,
 *               and zero evidence at all produce three mutually distinct
 *               summaries — guards the distinguishing-status assertions above
 *               against passing vacuously
 *
 * @spec_ref spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
 *   (D4 exercised-vs-declared split, D5 demoted per-task floor), AC-VS-6;
 *   SPEC-075 §Design Decisions D2, D6, D10;
 *   spec-plan-close-predicates-measure-invariants-an-applicability §D3, AC-PCI-5
 *   (AC-075-11 condition 1 and AC-PCI-6 are SUPERSEDED — see the REGRESSION rows);
 *   task-meets-floor-renders-pass-while-the-declared-scope-conjunct (the
 *   PlanAttestationPanel three-state badge fix this file's plan-branch chip
 *   tests mirror); task-adjudicationbar-s-compact-status-chip-still-derives-from
 *   (this file's derivePlanCloseChipStatus + summarizeForAdjudicationBar tests);
 *   task-two-more-evidence-consumers-erase-an-expected-fail-row-doc (the
 *   task/spec branches' expected-fail/inconclusive fix — supersedes the
 *   AC-WH-1 "reduces to none" pins that used to live in this describe block)
 */

import { describe, it, expect } from "vitest";
import {
  buildTaskAttestationInfos,
  declaredScopeCoverageVerdict,
  derivePlanCloseChipStatus,
  deriveAttestationSummary,
  deriveClaimedAcCoverage,
  deriveDeclaredScopeCoverage,
  summarizeForAdjudicationBar,
  UNRESOLVED_DECLARED_SCOPE,
  type AttestationSummary,
  type ClaimedAcCoverage,
  type DeclaredScopeCoverage,
  type DeclaredScopeCoverageVerdict,
  type EvidencePanelProjection,
  type TaskAttestationInfo,
} from "./evidence-panel.js";
import type { AcCoverageFact, AcceptanceCriterion } from "./acceptance.js";
import type { EvidenceEntry } from "./task-workflow.js";
import type { DocId, DocRecord } from "./types.js";

/** Vacuous claimed-AC coverage — the fixture value for every pre-existing test
 *  in this file that never modeled AC declarations at all. */
const EMPTY_COVERAGE: ClaimedAcCoverage = { exercised_acs: [], unattested_acs: [], meets_coverage: true };

/** Vacuous declared-scope coverage (nothing declarable, nothing declared) — the
 *  fixture value for `summarizeForAdjudicationBar`'s pre-existing `plan` tests,
 *  which pin `meets_floor`-only behavior and never model declared scope. */
const EMPTY_DECLARED_SCOPE: DeclaredScopeCoverage = {
  declared_acs: [],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};

/** A resolved, satisfied declared-scope verdict — pairs with {@link EMPTY_DECLARED_SCOPE}. */
const DECLARED_SCOPE_OK: DeclaredScopeCoverageVerdict = { ok: true };

// ─── Fixtures ────────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): DocId {
  _seq += 1;
  return `01HTASK${String(_seq).padStart(19, "0")}`;
}

function makeTask(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId();
  return {
    id,
    slug: `task-fixture-${id.slice(-4)}`,
    type: "task",
    role: "plan",
    title: `Task ${id}`,
    status: "draft",
    priority: "medium",
    content: "Task body",
    parent_id: "01HPLANAAAAAAAAAAAAAAAAAAA",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA" },
    ...overrides,
  } as DocRecord;
}

function selfReportedEntry(command: string): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result: "pass",
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
  };
}

function attestedEntry(command: string, result: "pass" | "fail" = "pass"): EvidenceEntry {
  return {
    oracle: "test",
    command,
    result,
    recorded_at: "2026-07-23T00:00:00.000Z",
    recorded_by: "agent:t",
    attestation: { runner: "lore-cli", exit_code: result === "pass" ? 0 : 1, duration_ms: 100, timed_out: false },
  };
}

function taskInfo(overrides: Partial<TaskAttestationInfo>): TaskAttestationInfo {
  return { slug: "task-x", title: "Task X", evidenceCount: 0, attestedCount: 0, ...overrides };
}

// ─── buildTaskAttestationInfos ───────────────────────────────────────────────

describe("buildTaskAttestationInfos", () => {
  it("HAPPY: derives evidenceCount/attestedCount per task from extra.verification_evidence", () => {
    const taskA = makeTask({
      slug: "task-a",
      title: "Task A",
      extra: {
        plan_id: "p",
        verification_evidence: [attestedEntry("bun test a"), selfReportedEntry("bun test a2")],
      },
    });
    const taskB = makeTask({
      slug: "task-b",
      title: "Task B",
      extra: { plan_id: "p", verification_evidence: [attestedEntry("bun test b")] },
    });

    const infos = buildTaskAttestationInfos([taskA, taskB]);

    expect(infos).toEqual([
      { slug: "task-a", title: "Task A", evidenceCount: 2, attestedCount: 1 },
      { slug: "task-b", title: "Task B", evidenceCount: 1, attestedCount: 1 },
    ]);
  });

  it("BOUNDARY: an empty tasks array yields an empty result", () => {
    expect(buildTaskAttestationInfos([])).toEqual([]);
  });

  it("BOUNDARY: a task with zero evidence entries yields evidenceCount:0, attestedCount:0", () => {
    const task = makeTask({ slug: "task-empty", extra: { plan_id: "p", verification_evidence: [] } });
    expect(buildTaskAttestationInfos([task])).toEqual([
      { slug: "task-empty", title: task.title, evidenceCount: 0, attestedCount: 0 },
    ]);
  });

  it("NEGATIVE: malformed (non-array) extra.verification_evidence does not throw, contributes zero counts", () => {
    const task = makeTask({ slug: "task-malformed", extra: { plan_id: "p", verification_evidence: "not-an-array" } });
    expect(() => buildTaskAttestationInfos([task])).not.toThrow();
    expect(buildTaskAttestationInfos([task])).toEqual([
      { slug: "task-malformed", title: task.title, evidenceCount: 0, attestedCount: 0 },
    ]);
  });

  it("STATE: preserves input order across multiple tasks with independent counts", () => {
    const tasks = [
      makeTask({ slug: "t1", extra: { plan_id: "p", verification_evidence: [selfReportedEntry("a")] } }),
      makeTask({ slug: "t2", extra: { plan_id: "p", verification_evidence: [] } }),
      makeTask({
        slug: "t3",
        extra: { plan_id: "p", verification_evidence: [attestedEntry("b"), attestedEntry("c")] },
      }),
    ];
    const infos = buildTaskAttestationInfos(tasks);
    expect(infos.map((i) => i.slug)).toEqual(["t1", "t2", "t3"]);
    expect(infos.map((i) => [i.evidenceCount, i.attestedCount])).toEqual([
      [1, 0],
      [0, 0],
      [2, 2],
    ]);
  });
});

// ─── deriveAttestationSummary ────────────────────────────────────────────────

describe("deriveAttestationSummary", () => {
  it("HAPPY: a fully-attested set at/above the floor yields meets_floor:true with a numeric ratio", () => {
    const infos = [taskInfo({ slug: "t1", evidenceCount: 2, attestedCount: 2 })];
    const summary = deriveAttestationSummary(infos, 0.5, []);
    expect(summary).toEqual<AttestationSummary>({
      total_evidence: 2,
      attested: 2,
      ratio: 1,
      min_ratio: 0.5,
      claimed_ac_coverage: EMPTY_COVERAGE,
      meets_floor: true,
      zero_attested_tasks: [],
    });
  });

  it("REGRESSION: vacuous pass — no evidence anywhere yields ratio:null (never a fabricated 0), meets_floor:true", () => {
    expect(deriveAttestationSummary([], 0.5, [])).toEqual<AttestationSummary>({
      total_evidence: 0,
      attested: 0,
      ratio: null,
      min_ratio: 0.5,
      claimed_ac_coverage: EMPTY_COVERAGE,
      meets_floor: true,
      zero_attested_tasks: [],
    });
    const zeroEvidenceTask = taskInfo({ slug: "never-run", evidenceCount: 0, attestedCount: 0 });
    expect(deriveAttestationSummary([zeroEvidenceTask], 0.5, []).ratio).toBeNull();
  });

  it("BOUNDARY: ratio exactly equal to minRatio passes (>=, not >)", () => {
    const infos = [taskInfo({ slug: "t1", evidenceCount: 2, attestedCount: 1 })];
    const summary = deriveAttestationSummary(infos, 0.5, []);
    expect(summary.ratio).toBe(0.5);
    expect(summary.meets_floor).toBe(true);
  });

  it("BOUNDARY: minRatio null disables the ratio conjunct entirely — a below-floor ratio no longer blocks on its own", () => {
    const infos = [taskInfo({ slug: "t1", evidenceCount: 10, attestedCount: 1 })];
    const summary = deriveAttestationSummary(infos, null, []);
    expect(summary.ratio).toBe(0.1);
    expect(summary.min_ratio).toBeNull();
    expect(summary.meets_floor).toBe(true);
  });

  // ─── REGRESSION (supersedes AC-075-11 condition 1): the per-task
  //     zero-attested condition is DEMOTED to a reported fact
  //     (spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
  //     D5) — still COMPUTED into zero_attested_tasks, no longer in
  //     meets_floor. This assertion was inverted in the SAME slice that
  //     changed the behavior; a stale `meets_floor: false` here would
  //     re-legalize the per-task proxy D5 removed. ─────────────────────────
  it("REGRESSION (D5 supersedes AC-075-11 condition 1): a zero-attested task is REPORTED but no longer lowers meets_floor when the ratio conjunct is satisfied", () => {
    // Task A: 10 attested. Task B: 1 self-reported, 0 attested. Ratio = 10/11 ≈ 0.91 (above 0.5).
    const infos = [
      taskInfo({ slug: "task-a", evidenceCount: 10, attestedCount: 10 }),
      taskInfo({ slug: "task-b", evidenceCount: 1, attestedCount: 0 }),
    ];
    const summary = deriveAttestationSummary(infos, 0.5, []);
    expect(summary.ratio).toBeCloseTo(10 / 11, 5);
    expect(summary.meets_floor).toBe(true);
    // DEMOTED, not deleted — the computation survives for the feeding pack and
    // the dashboard panel.
    expect(summary.zero_attested_tasks).toEqual(["task-b"]);
  });

  // ─── AC-075-11 condition 2 (renumbered condition 3 post-AC-PCI): ratio below
  //     floor blocks even when every task individually carries >=1 attested
  //     entry ─────────────────────────────────────────────────────────────
  it("NEGATIVE AC-075-11: a below-floor ratio blocks even when every task has >=1 attested entry", () => {
    // Task A: 4 entries, 1 attested. Task B: 1 entry, 1 attested. Total 5 evidence / 2 attested = 0.4 < 0.5.
    // Neither task has zero attested entries — ONLY the ratio condition trips this case.
    const infos = [
      taskInfo({ slug: "task-a", evidenceCount: 4, attestedCount: 1 }),
      taskInfo({ slug: "task-b", evidenceCount: 1, attestedCount: 1 }),
    ];
    const summary = deriveAttestationSummary(infos, 0.5, []);
    expect(summary.ratio).toBe(0.4);
    expect(summary.zero_attested_tasks).toEqual([]);
    expect(summary.meets_floor).toBe(false);
  });

  it("STATE: zero_attested_tasks accumulates every offending task's slug, not just the first", () => {
    const infos = [
      taskInfo({ slug: "bad-1", evidenceCount: 3, attestedCount: 0 }),
      taskInfo({ slug: "good", evidenceCount: 1, attestedCount: 1 }),
      taskInfo({ slug: "bad-2", evidenceCount: 2, attestedCount: 0 }),
    ];
    const summary = deriveAttestationSummary(infos, 0.1, []);
    expect(summary.zero_attested_tasks).toEqual(["bad-1", "bad-2"]);
    // meets_floor tracks the RATIO alone (D5): 1/6 ≈ 0.17 >= 0.1, so it passes
    // even with two zero-attested tasks reported.
    expect(summary.meets_floor).toBe(true);
  });

  // ─── REGRESSION (supersedes AC-PCI-6): the coverage conjunct no longer
  //     reads the EXERCISED set (spec-declared-scope-attestation-contract-
  //     task-owned-ac-scope §Facts D4) — an unattested exercised AC is
  //     REPORTED here and gated only through DeclaredScopeCoverage, so
  //     evidence can never define the scope it is audited against. ─────────
  it("REGRESSION (D4 supersedes AC-PCI-6): an unattested EXERCISED AC is reported in claimed_ac_coverage but no longer lowers meets_floor", () => {
    const infos = [
      taskInfo({ slug: "task-a", evidenceCount: 2, attestedCount: 2 }),
      taskInfo({ slug: "task-b", evidenceCount: 2, attestedCount: 2 }),
    ];
    const acCoverage: AcCoverageFact[] = [
      {
        ac_id: "AC-1",
        mode: "script",
        pass: 1,
        fail: 0,
        refs: [{ task_id: "task-a", result: "pass", attested: true }],
        attested_pass: 1,
        attested_fail: 0,
        falsified: 0,
      },
      {
        ac_id: "AC-2",
        mode: "script",
        pass: 1,
        fail: 0,
        refs: [{ task_id: "task-b", result: "pass" }],
        attested_pass: 0,
        attested_fail: 0,
        falsified: 0,
      },
    ];
    const summary = deriveAttestationSummary(infos, 0.5, acCoverage);
    expect(summary.ratio).toBe(1);
    expect(summary.zero_attested_tasks).toEqual([]);
    expect(summary.claimed_ac_coverage.unattested_acs).toEqual(["AC-2"]);
    expect(summary.claimed_ac_coverage.meets_coverage).toBe(false);
    // The fact is REPORTED; the verdict it used to drive now comes from the
    // DECLARED scope (see the AC-VS-6 suite below).
    expect(summary.meets_floor).toBe(true);
  });
});

// ─── deriveClaimedAcCoverage (AC-PCI-5) ──────────────────────────────────────

function acFact(overrides: Partial<AcCoverageFact> & { ac_id: string }): AcCoverageFact {
  return {
    mode: "script",
    pass: 0,
    fail: 0,
    refs: [],
    attested_pass: 0,
    attested_fail: 0,
    falsified: 0,
    ...overrides,
  };
}

describe("deriveClaimedAcCoverage", () => {
  it("HAPPY claimed set (AC-PCI-5): exercised_acs contains exactly the script-mode criteria carrying >=1 evidence ref, excluding ai/human-mode criteria even when they carry refs", () => {
    const coverage: AcCoverageFact[] = [
      acFact({
        ac_id: "AC-1",
        refs: [{ task_id: "t1", result: "pass", attested: true }],
        attested_pass: 1,
      }),
      acFact({ ac_id: "AC-2", mode: "ai", refs: [{ task_id: "t1", result: "pass" }] }),
      acFact({ ac_id: "AC-3", mode: "human", refs: [{ task_id: "t1", result: "pass" }] }),
    ];
    const result = deriveClaimedAcCoverage(coverage);
    expect(result.exercised_acs).toEqual(["AC-1"]);
    expect(result.unattested_acs).toEqual([]);
    expect(result.meets_coverage).toBe(true);
  });

  it("NEGATIVE claimed set (AC-PCI-5): a script-mode criterion with zero evidence refs is excluded from exercised_acs entirely", () => {
    const coverage: AcCoverageFact[] = [
      acFact({ ac_id: "AC-1", refs: [] }),
      acFact({ ac_id: "AC-2", refs: [{ task_id: "t1", result: "pass", attested: true }], attested_pass: 1 }),
    ];
    const result = deriveClaimedAcCoverage(coverage);
    expect(result.exercised_acs).toEqual(["AC-2"]);
  });

  it("NEGATIVE claimed set (AC-PCI-5): an evidence ac_ref naming an undeclared id never appears in exercised_acs or unattested_acs — computeAcCoverage's own output already excludes dangling refs structurally, so a coverage array simulating that (one row per DECLARED criterion only) never surfaces the dangling id here", () => {
    // computeAcCoverage emits one row per DECLARED criterion; a dangling ac_ref
    // (an id no longer declared) is dropped BEFORE this function ever sees the
    // data — there is no "AC-DANGLING" row in coverage at all, by construction.
    const coverage: AcCoverageFact[] = [
      acFact({ ac_id: "AC-1", refs: [{ task_id: "t1", result: "pass", attested: true }], attested_pass: 1 }),
    ];
    const result = deriveClaimedAcCoverage(coverage);
    expect(result.exercised_acs).not.toContain("AC-DANGLING");
    expect(result.unattested_acs).not.toContain("AC-DANGLING");
  });

  it("BOUNDARY claimed set (AC-PCI-5): an empty coverage array yields an empty claimed set, vacuously meets_coverage true", () => {
    expect(deriveClaimedAcCoverage([])).toEqual<ReturnType<typeof deriveClaimedAcCoverage>>({
      exercised_acs: [],
      unattested_acs: [],
      meets_coverage: true,
    });
  });

  it("STATE claimed set (AC-PCI-5): unattested_acs names every claimed AC with zero attested refs, counting a runner-issued fail as attested (never attested_pass alone)", () => {
    const coverage: AcCoverageFact[] = [
      acFact({ ac_id: "AC-FAIL-ATTESTED", refs: [{ task_id: "t1", result: "fail", attested: true }], attested_fail: 1 }),
      acFact({ ac_id: "AC-SELF-REPORTED", refs: [{ task_id: "t1", result: "pass" }] }),
    ];
    const result = deriveClaimedAcCoverage(coverage);
    expect(result.exercised_acs).toEqual(["AC-FAIL-ATTESTED", "AC-SELF-REPORTED"]);
    expect(result.unattested_acs).toEqual(["AC-SELF-REPORTED"]);
    expect(result.meets_coverage).toBe(false);
  });
});

// ─── deriveDeclaredScopeCoverage + the coverage conjunct's verdict (AC-VS-6) ─
//
// spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts (D4): the
// EXERCISED set (evidence-derived, descriptive) and the DECLARED set
// (`task.extra.ac_scope` ∩ the spec's declared script-mode criteria) are two
// independent facts with NO fallback between them. The oracle for AC-VS-6 is a
// fixture where they DISAGREE — tasks carrying evidence while declaring no
// scope at all: only possible if neither field is computed from the other.

/** A task carrying evidence and declaring NO `ac_scope` — the legacy shape every
 *  pre-`lore scope add` task has. */
function undeclaredEvidenceTask(slug: string): DocRecord {
  return makeTask({
    slug,
    title: `Task ${slug}`,
    extra: { plan_id: "p", verification_evidence: [attestedEntry(`bun test ${slug}`)] },
  });
}

/** The SAME task, now declaring a scope — the control proving `scope_undeclared`
 *  keys on the declaration itself, not on the presence of evidence. */
function declaredEvidenceTask(slug: string, acScope: unknown): DocRecord {
  return makeTask({
    slug,
    title: `Task ${slug}`,
    extra: { plan_id: "p", ac_scope: acScope, verification_evidence: [attestedEntry(`bun test ${slug}`)] },
  });
}

describe("exercised versus declared scope (AC-VS-6)", () => {
  const attestedAc1 = (): AcCoverageFact =>
    acFact({
      ac_id: "AC-1",
      refs: [{ task_id: "task-undeclared", result: "pass", attested: true }],
      attested_pass: 1,
    });

  it("STATE (AC-VS-6): tasks carrying evidence but declaring no scope report declared_acs [] + scope_undeclared true WHILE exercised_acs is non-empty, and the coverage conjunct returns notApplicable(scope-undeclared) — never ok", () => {
    const coverage = [attestedAc1()];
    const tasks = [undeclaredEvidenceTask("task-undeclared"), undeclaredEvidenceTask("task-undeclared-2")];

    const declared = deriveDeclaredScopeCoverage(tasks, coverage);
    const exercised = deriveClaimedAcCoverage(coverage);

    // The two facts DISAGREE — the whole point of D4's "no fallback".
    expect(declared.declared_acs).toEqual([]);
    expect(declared.scope_undeclared).toBe(true);
    expect(exercised.exercised_acs).toEqual(["AC-1"]);
    expect(exercised.exercised_acs.length).toBeGreaterThan(0);

    // The coverage conjunct reports APPLICABILITY, never a vacuous pass.
    const verdict = declaredScopeCoverageVerdict(declared, "plan-undeclared");
    expect(verdict).toEqual({
      notApplicable: true,
      reason: "scope-undeclared",
      referent: "plan-undeclared",
    });
    // Structurally NOT a pass/fail result: an `ok` key would let a caller's
    // `if (!result.ok)` silently route this into the PASS branch.
    expect("ok" in verdict).toBe(false);
  });

  it("HAPPY (AC-VS-6 control): a task declaring a scope whose declared AC is attested yields declared_acs [AC-1], scope_undeclared false, and an ok verdict", () => {
    const coverage = [attestedAc1()];
    const declared = deriveDeclaredScopeCoverage([declaredEvidenceTask("task-declared", ["AC-1"])], coverage);

    expect(declared).toEqual<ReturnType<typeof deriveDeclaredScopeCoverage>>({
      declared_acs: ["AC-1"],
      unattested_acs: [],
      scope_undeclared: false,
      meets_coverage: true,
    });
    expect(declaredScopeCoverageVerdict(declared, "plan-declared")).toEqual({ ok: true });
  });

  it("NEGATIVE (AC-VS-6): a declared AC with zero attested refs fails the conjunct — a measured violation outranks the applicability verdict even when ANOTHER evidence-bearing task declares nothing", () => {
    const coverage = [
      acFact({ ac_id: "AC-1", refs: [{ task_id: "task-declared", result: "pass" }] }),
    ];
    const declared = deriveDeclaredScopeCoverage(
      [declaredEvidenceTask("task-declared", ["AC-1"]), undeclaredEvidenceTask("task-undeclared")],
      coverage,
    );

    expect(declared.declared_acs).toEqual(["AC-1"]);
    expect(declared.unattested_acs).toEqual(["AC-1"]);
    expect(declared.scope_undeclared).toBe(true);
    expect(declared.meets_coverage).toBe(false);
    // fail > notApplicable: the DECLARED half measured a real violation, so
    // reporting "inapplicable" would erase it.
    expect(declaredScopeCoverageVerdict(declared, "plan-mixed")).toEqual({
      ok: false,
      unattested_acs: ["AC-1"],
    });
  });

  it("BOUNDARY (AC-VS-6): an EMPTY ac_scope array is a DECLARATION that claims nothing — scope_undeclared stays false, distinct from an absent field", () => {
    const coverage = [attestedAc1()];
    const empty = deriveDeclaredScopeCoverage([declaredEvidenceTask("task-empty", [])], coverage);
    expect(empty.scope_undeclared).toBe(false);
    expect(empty.declared_acs).toEqual([]);

    const absent = deriveDeclaredScopeCoverage([undeclaredEvidenceTask("task-absent")], coverage);
    expect(absent.scope_undeclared).toBe(true);
  });

  it("BOUNDARY (AC-VS-6): a task with NO evidence is never consulted for a declaration — its absent ac_scope cannot make a fully-declared plan report scope_undeclared", () => {
    const coverage = [attestedAc1()];
    const neverRan = makeTask({ slug: "task-never-ran", extra: { plan_id: "p" } });
    const declared = deriveDeclaredScopeCoverage(
      [declaredEvidenceTask("task-declared", ["AC-1"]), neverRan],
      coverage,
    );
    expect(declared.scope_undeclared).toBe(false);
    expect(declared.declared_acs).toEqual(["AC-1"]);
  });

  it("BOUNDARY (AC-VS-6): declared ids outside the spec's declared script-mode criteria are intersected away — a dangling id and an ai-mode id never enter declared_acs", () => {
    const coverage: AcCoverageFact[] = [
      acFact({ ac_id: "AC-1", refs: [{ task_id: "t", result: "pass", attested: true }], attested_pass: 1 }),
      acFact({ ac_id: "AC-AI", mode: "ai", refs: [{ task_id: "t", result: "pass" }] }),
    ];
    const declared = deriveDeclaredScopeCoverage(
      [declaredEvidenceTask("task-wide", ["AC-1", "AC-AI", "AC-DANGLING"])],
      coverage,
    );
    expect(declared.declared_acs).toEqual(["AC-1"]);
    expect(declared.unattested_acs).toEqual([]);
  });

  it("ERROR (AC-VS-6): a malformed ac_scope (non-array, or an array with a non-string member) is reported AS undeclared and never throws — never silently treated as a resolved declaration", () => {
    const coverage = [attestedAc1()];
    for (const malformed of ["AC-1", 42, { AC: 1 }, null, ["AC-1", 7]] as unknown[]) {
      const declared = deriveDeclaredScopeCoverage([declaredEvidenceTask("task-bad", malformed)], coverage);
      expect(declared.scope_undeclared).toBe(true);
      expect(declared.declared_acs).toEqual([]);
    }
    expect(() => deriveDeclaredScopeCoverage([declaredEvidenceTask("task-bad", "AC-1")], coverage)).not.toThrow();
  });

  it("BOUNDARY (AC-VS-6): an empty task list and an empty coverage array both yield a RESOLVED, vacuously-satisfied declaration — nothing bore evidence, so nothing was left undeclared", () => {
    expect(deriveDeclaredScopeCoverage([], [attestedAc1()])).toEqual<
      ReturnType<typeof deriveDeclaredScopeCoverage>
    >({ declared_acs: [], unattested_acs: [], scope_undeclared: false, meets_coverage: true });
    expect(deriveDeclaredScopeCoverage([declaredEvidenceTask("task-declared", ["AC-1"])], [])).toEqual<
      ReturnType<typeof deriveDeclaredScopeCoverage>
    >({ declared_acs: [], unattested_acs: [], scope_undeclared: false, meets_coverage: true });
  });

  it("STATE (AC-VS-6): the declared union spans tasks and is emitted in DECLARATION order, counting a runner-issued fail as attested", () => {
    const coverage: AcCoverageFact[] = [
      acFact({ ac_id: "AC-1", refs: [{ task_id: "t1", result: "fail", attested: true }], attested_fail: 1 }),
      acFact({ ac_id: "AC-2", refs: [{ task_id: "t2", result: "pass" }] }),
      acFact({ ac_id: "AC-3", refs: [{ task_id: "t3", result: "pass", attested: true }], attested_pass: 1 }),
    ];
    const declared = deriveDeclaredScopeCoverage(
      [
        declaredEvidenceTask("task-b", ["AC-3"]),
        declaredEvidenceTask("task-a", ["AC-2", "AC-1"]),
      ],
      coverage,
    );
    expect(declared.declared_acs).toEqual(["AC-1", "AC-2", "AC-3"]);
    expect(declared.unattested_acs).toEqual(["AC-2"]);
    expect(declared.meets_coverage).toBe(false);
  });

  it("REGRESSION (AC-VS-6): UNRESOLVED_DECLARED_SCOPE reports undeclared, so a caller that never resolved the fact can never fabricate a compliant declaration", () => {
    expect(UNRESOLVED_DECLARED_SCOPE.scope_undeclared).toBe(true);
    expect(UNRESOLVED_DECLARED_SCOPE.declared_acs).toEqual([]);
    expect(declaredScopeCoverageVerdict(UNRESOLVED_DECLARED_SCOPE, "plan-x")).toEqual({
      notApplicable: true,
      reason: "scope-undeclared",
      referent: "plan-x",
    });
  });
});

// ─── summarizeForAdjudicationBar ─────────────────────────────────────────────

describe("summarizeForAdjudicationBar", () => {
  it("HAPPY: a task panel with a fail among passes reduces to fail-first status", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [attestedEntry("a", "pass"), attestedEntry("b", "fail"), selfReportedEntry("c")],
      ac_refs: [],
    };
    const summary = summarizeForAdjudicationBar(panel);
    expect(summary).toEqual({
      doc_type: "task",
      evidence_count: 3,
      attested_count: 2,
      pass_count: 2,
      fail_count: 1,
      expected_fail_count: 0,
      inconclusive_count: 0,
      status: "fail",
    });
  });

  it("HAPPY: a task panel with only passes reduces to status pass", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [attestedEntry("a")],
      ac_refs: [],
    };
    expect(summarizeForAdjudicationBar(panel).status).toBe("pass");
  });

  it("BOUNDARY: a task panel with no evidence at all reduces to status none", () => {
    const panel: EvidencePanelProjection = { doc_type: "task", evidence: [], ac_refs: [] };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "task",
      evidence_count: 0,
      attested_count: 0,
      pass_count: 0,
      fail_count: 0,
      expected_fail_count: 0,
      inconclusive_count: 0,
      status: "none",
    });
  });

  it("HAPPY: a spec panel aggregates pass/fail/attested across every AC's coverage fact", () => {
    const coverage: AcCoverageFact[] = [
      {
        ac_id: "AC-1",
        mode: "script",
        pass: 2,
        fail: 0,
        refs: [
          { task_id: "t1", result: "pass", attested: true },
          { task_id: "t2", result: "pass" },
        ],
        attested_pass: 1,
        attested_fail: 0,
        falsified: 0,
      },
      {
        ac_id: "AC-2",
        mode: "script",
        pass: 0,
        fail: 1,
        refs: [{ task_id: "t3", result: "fail", attested: true }],
        attested_pass: 0,
        attested_fail: 1,
        falsified: 1,
      },
    ];
    const criteria: AcceptanceCriterion[] = [];
    const panel: EvidencePanelProjection = { doc_type: "spec", criteria, coverage, task_count: 3 };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "spec",
      evidence_count: 3,
      attested_count: 2,
      pass_count: 2,
      fail_count: 1,
      expected_fail_count: 0,
      inconclusive_count: 0,
      status: "fail",
    });
  });

  it("BOUNDARY: a spec panel with no coverage rows at all reduces to status none", () => {
    const panel: EvidencePanelProjection = { doc_type: "spec", criteria: [], coverage: [], task_count: 0 };
    expect(summarizeForAdjudicationBar(panel).status).toBe("none");
  });

  it("HAPPY: a plan panel below the attestation floor reduces to status fail", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "plan",
      attestation: {
        total_evidence: 5,
        attested: 2,
        ratio: 0.4,
        min_ratio: 0.5,
        claimed_ac_coverage: EMPTY_COVERAGE,
        meets_floor: false,
        zero_attested_tasks: [],
      },
      tasks: [],
      declared_scope_coverage: EMPTY_DECLARED_SCOPE,
      declared_scope_verdict: DECLARED_SCOPE_OK,
    };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "plan",
      evidence_count: 5,
      attested_count: 2,
      pass_count: 0,
      fail_count: 0,
      expected_fail_count: 0,
      inconclusive_count: 0,
      status: "fail",
    });
  });

  it("REGRESSION: a plan panel with vacuous (no-evidence) attestation reduces to status none, not pass", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "plan",
      attestation: {
        total_evidence: 0,
        attested: 0,
        ratio: null,
        min_ratio: 0.5,
        claimed_ac_coverage: EMPTY_COVERAGE,
        meets_floor: true,
        zero_attested_tasks: [],
      },
      tasks: [],
      declared_scope_coverage: EMPTY_DECLARED_SCOPE,
      declared_scope_verdict: DECLARED_SCOPE_OK,
    };
    expect(summarizeForAdjudicationBar(panel).status).toBe("none");
  });

  it("BOUNDARY: the other-doc-type panel always reduces to a zeroed, status:none summary", () => {
    const panel: EvidencePanelProjection = { doc_type: "other" };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "other",
      evidence_count: 0,
      attested_count: 0,
      pass_count: 0,
      fail_count: 0,
      expected_fail_count: 0,
      inconclusive_count: 0,
      status: "none",
    });
  });

  // ─── spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1
  //     (AC-WH-1) classification assertions — UPDATED by
  //     task-two-more-evidence-consumers-erase-an-expected-fail-row-doc, which
  //     found the ORIGINAL AC-WH-1 pins here were pinning the DEFECT itself: a
  //     task/spec whose only evidence was a deliberate RED pin rendered
  //     `status: "none"`, byte-identical to zero evidence at all — the
  //     "auditor told the opposite of the truth" bug. `pass_count`/`fail_count`
  //     still correctly exclude "expected-fail"/"inconclusive" (unchanged,
  //     REGRESSION-pinned above), but the row no longer vanishes: it now
  //     surfaces via `expected_fail_count`/`inconclusive_count` and a matching
  //     `status`. ────────────────────────────────────────────────────────────
  it("task-two-more-evidence-consumers-erase-an-expected-fail-row-doc: a task panel whose only evidence is expected-fail reduces to status 'expected-fail', NEVER 'none' (the defect this fix removes)", () => {
    const expectedFailEntry: EvidenceEntry = {
      oracle: "test",
      command: "bun test",
      result: "expected-fail",
      recorded_at: "2026-07-27T00:00:00.000Z",
      recorded_by: "agent:t",
    };
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [expectedFailEntry],
      ac_refs: [],
    };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "task",
      evidence_count: 1,
      attested_count: 0,
      pass_count: 0,
      fail_count: 0,
      expected_fail_count: 1,
      inconclusive_count: 0,
      status: "expected-fail",
    });
  });

  it("a task panel whose only evidence is inconclusive reduces to status 'inconclusive', NEVER 'none' (same fix, the runner-issued sibling value)", () => {
    const inconclusiveEntry: EvidenceEntry = {
      oracle: "test",
      command: "bun test",
      result: "inconclusive",
      recorded_at: "2026-07-27T00:00:00.000Z",
      recorded_by: "agent:t",
    };
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [inconclusiveEntry],
      ac_refs: [],
    };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "task",
      evidence_count: 1,
      attested_count: 0,
      pass_count: 0,
      fail_count: 0,
      expected_fail_count: 0,
      inconclusive_count: 1,
      status: "inconclusive",
    });
  });

  it("an inconclusive row outranks an expected-fail row when both are present and neither pass nor fail exists (precedence: fail > pass > inconclusive > expected-fail > none)", () => {
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [
        { oracle: "test", command: "bun test a", result: "expected-fail", recorded_at: "t", recorded_by: "agent:t" },
        { oracle: "test", command: "bun test b", result: "inconclusive", recorded_at: "t", recorded_by: "agent:t" },
      ],
      ac_refs: [],
    };
    expect(summarizeForAdjudicationBar(panel).status).toBe("inconclusive");
  });

  it("AC-WH-1 REGRESSION: an expected-fail entry alongside a real fail still reduces to fail-first status, never masked", () => {
    const expectedFailEntry: EvidenceEntry = {
      oracle: "test",
      command: "bun test",
      result: "expected-fail",
      recorded_at: "2026-07-27T00:00:00.000Z",
      recorded_by: "agent:t",
    };
    const panel: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [attestedEntry("a", "fail"), expectedFailEntry],
      ac_refs: [],
    };
    const summary = summarizeForAdjudicationBar(panel);
    expect(summary.status).toBe("fail");
    // reason: evidence_count includes the expected-fail entry (it IS a recorded
    // evidence entry), but pass_count/fail_count must not — expected-fail
    // contributes to neither bucket, matching "inconclusive"'s exact same property.
    // It still surfaces via expected_fail_count instead of vanishing.
    expect(summary.evidence_count).toBe(2);
    expect(summary.pass_count).toBe(0);
    expect(summary.fail_count).toBe(1);
    expect(summary.expected_fail_count).toBe(1);
  });

  it("task-two-more-evidence-consumers-erase-an-expected-fail-row-doc: a spec panel whose only referenced evidence is expected-fail (via fact.refs) reduces to status 'expected-fail', not 'none' (computeAcCoverage's pass/fail exclusion is preserved — refs is where the fix reads the residual value from)", () => {
    // AcCoverageFact.pass/fail are computeAcCoverage's own exact-match counts and
    // correctly stay 0/0 for an AC with only expected-fail refs (unchanged,
    // computeAcCoverage itself is out of this task's scope) — but `fact.refs`
    // still carries the raw "expected-fail" row, and THIS read site must recover
    // it from there rather than trusting only the two pre-aggregated fields.
    const coverage: AcCoverageFact[] = [
      {
        ac_id: "AC-1",
        mode: "script",
        pass: 0,
        fail: 0,
        refs: [{ task_id: "t1", result: "expected-fail" }],
        attested_pass: 0,
        attested_fail: 0,
        falsified: 1,
      },
    ];
    const panel: EvidencePanelProjection = { doc_type: "spec", criteria: [], coverage, task_count: 1 };
    expect(summarizeForAdjudicationBar(panel)).toEqual({
      doc_type: "spec",
      evidence_count: 1,
      attested_count: 0,
      pass_count: 0,
      fail_count: 0,
      expected_fail_count: 1,
      inconclusive_count: 0,
      status: "expected-fail",
    });
  });

  it("BOUNDARY/CONTROL: a task panel with only a pass row, only an expected-fail row, and zero evidence produce three mutually distinct summaries (guards the assertions above against passing vacuously)", () => {
    const passOnly: EvidencePanelProjection = { doc_type: "task", evidence: [attestedEntry("a")], ac_refs: [] };
    const expectedFailOnly: EvidencePanelProjection = {
      doc_type: "task",
      evidence: [
        { oracle: "test", command: "bun test", result: "expected-fail", recorded_at: "t", recorded_by: "agent:t" },
      ],
      ac_refs: [],
    };
    const zeroEvidence: EvidencePanelProjection = { doc_type: "task", evidence: [], ac_refs: [] };

    const a = summarizeForAdjudicationBar(passOnly);
    const b = summarizeForAdjudicationBar(expectedFailOnly);
    const c = summarizeForAdjudicationBar(zeroEvidence);

    expect(a.status).toBe("pass");
    expect(b.status).toBe("expected-fail");
    expect(c.status).toBe("none");
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });

  // ─── task-adjudicationbar-s-compact-status-chip-still-derives-from ─────────
  // The plan branch used to derive `status` from `meets_floor` ALONE, so a
  // plan with an undeclared declared-scope conjunct rendered a PASSING chip
  // here while `PlanAttestationPanel`'s badge (fixed by the sibling task
  // task-meets-floor-renders-pass-while-the-declared-scope-conjunct) rendered
  // "scope undeclared" — the two dashboard surfaces DISAGREED. These tests
  // pin the fixed three-valued behavior; the first ("was the disagreement")
  // documents exactly the fixture that used to prove the bug.
  describe("plan branch — declared-scope conjunct chip status", () => {
    const scopeUndeclaredVerdict: DeclaredScopeCoverageVerdict = {
      notApplicable: true,
      reason: "scope-undeclared",
      referent: "plan-x",
    };

    /** A non-vacuous plan panel (total_evidence > 0) whose RATIO conjunct
     *  alone passes — every field the declared-scope conjunct doesn't own is
     *  fixed so each test below isolates that one conjunct's effect on `status`. */
    function makeNonVacuousPlanPanel(
      overrides: {
        attestation?: Partial<AttestationSummary>;
        declared_scope_verdict?: DeclaredScopeCoverageVerdict;
      } = {},
    ): EvidencePanelProjection {
      return {
        doc_type: "plan",
        attestation: {
          total_evidence: 4,
          attested: 2,
          ratio: 0.5,
          min_ratio: 0.5,
          claimed_ac_coverage: EMPTY_COVERAGE,
          meets_floor: true,
          zero_attested_tasks: [],
          ...overrides.attestation,
        },
        tasks: [],
        declared_scope_coverage: EMPTY_DECLARED_SCOPE,
        declared_scope_verdict: overrides.declared_scope_verdict ?? DECLARED_SCOPE_OK,
      };
    }

    it("HAPPY (this was the exact disagreement, now fixed): a scope-undeclared plan whose ratio conjunct alone passes reduces to status 'scope-undeclared', NEVER 'pass' — the same fixture PlanAttestationPanel renders as 'scope undeclared'", () => {
      const panel = makeNonVacuousPlanPanel({ declared_scope_verdict: scopeUndeclaredVerdict });
      const summary = summarizeForAdjudicationBar(panel);
      expect(summary.status).toBe("scope-undeclared");
      expect(summary.status).not.toBe("pass");
    });

    it("CONTROL (AC #3, guards against an unconditionally-negative chip): a plan that genuinely meets BOTH conjuncts still reduces to status 'pass' on the compact chip", () => {
      const panel = makeNonVacuousPlanPanel({ declared_scope_verdict: DECLARED_SCOPE_OK });
      expect(summarizeForAdjudicationBar(panel).status).toBe("pass");
    });

    it("NEGATIVE: a declared-but-unattested scope reduces to 'fail' even when the ratio conjunct alone passes", () => {
      const panel = makeNonVacuousPlanPanel({
        declared_scope_verdict: { ok: false, unattested_acs: ["AC-9"] },
      });
      expect(summarizeForAdjudicationBar(panel).status).toBe("fail");
    });

    it("BOUNDARY: a failing ratio conjunct wins precedence over an undeclared scope — reduces to 'fail', never 'scope-undeclared'", () => {
      const panel = makeNonVacuousPlanPanel({
        attestation: { meets_floor: false },
        declared_scope_verdict: scopeUndeclaredVerdict,
      });
      expect(summarizeForAdjudicationBar(panel).status).toBe("fail");
    });

    it("REGRESSION: a vacuous (zero-evidence) plan still reduces to 'none', never 'pass' or 'scope-undeclared', regardless of the declared-scope verdict", () => {
      const panel = makeNonVacuousPlanPanel({
        attestation: { total_evidence: 0, attested: 0, ratio: null, meets_floor: true },
        declared_scope_verdict: scopeUndeclaredVerdict,
      });
      expect(summarizeForAdjudicationBar(panel).status).toBe("none");
    });
  });
});

// ─── derivePlanCloseChipStatus ───────────────────────────────────────────────

describe("derivePlanCloseChipStatus", () => {
  it("HAPPY: both conjuncts pass => 'pass'", () => {
    expect(derivePlanCloseChipStatus(true, { ok: true })).toBe("pass");
  });

  it("NEGATIVE: the ratio conjunct fails => 'fail' regardless of the declared-scope verdict", () => {
    expect(
      derivePlanCloseChipStatus(false, { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" }),
    ).toBe("fail");
  });

  it("NEGATIVE: the declared-scope conjunct measurably fails => 'fail' even though the ratio conjunct alone passes", () => {
    expect(derivePlanCloseChipStatus(true, { ok: false, unattested_acs: ["AC-1"] })).toBe("fail");
  });

  it("BOUNDARY: the declared-scope conjunct is not-applicable => 'scope-undeclared', never 'pass'", () => {
    expect(
      derivePlanCloseChipStatus(true, { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" }),
    ).toBe("scope-undeclared");
  });

  it("BOUNDARY: a failing ratio conjunct wins precedence over an undeclared scope — 'fail', never 'scope-undeclared'", () => {
    expect(
      derivePlanCloseChipStatus(false, { notApplicable: true, reason: "scope-undeclared", referent: "plan-x" }),
    ).toBe("fail");
  });
});
