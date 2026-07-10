/**
 * Pure aggregation arithmetic for the `lore assess` golden-fixture harness
 * (`scripts/assess-golden.ts`, SPEC-040 §T3 D7). Given N scripted per-fixture judge
 * outcomes for a "candidate" prompt version and an "incumbent" prompt version, computes
 * a 3-run majority label per fixture and decides whether the candidate is promotable —
 * a non-inferiority check against the incumbent's own agreement-with-expected rate.
 *
 * Public surface:
 *   - GOLDEN_DIRECTION_LABELS / GoldenDirectionLabel — the three coarse outcome buckets
 *     a fixture's judge run is classified into (`deriveGoldenDirectionLabel` maps a raw
 *     `overall_score` onto this taxonomy: >=80 "met", <40 "not_met", else "partial" —
 *     the SAME thresholds `buildAssessPromptV6`'s rubric anchors describe to the judge,
 *     but this module never imports the prompt builder — it operates on already-scored
 *     numbers, kept deliberately separate from "how the score was produced").
 *   - computeMajorityLabel(labels) — deterministic majority vote over an odd-length
 *     array of labels; a genuine N-way tie (every label appears equally) resolves to
 *     the MOST CONSERVATIVE label (not_met > partial > met), mirroring the judge
 *     prompt's own "score unverifiable claims conservatively" instruction.
 *   - aggregateGoldenRun(runs) — per-fixture candidate/incumbent majority + whether
 *     each matches its fixture's expected label, plus the two aggregate agreement
 *     rates and a `promotable` verdict (candidate agreement >= incumbent agreement;
 *     ties pass — non-inferiority, not strict improvement).
 *
 * Invariants:
 *   - No IO, no Date.now()/Math.random() — same (labels, expected) input always
 *     produces the same output (SPEC-040 §T3 D7 "deterministic, no Date/random").
 *   - computeMajorityLabel never silently drops a tie to an arbitrary array-order
 *     winner — the conservative tie-break is an explicit, documented rule, not an
 *     accident of iteration order.
 *   - aggregateGoldenRun treats a zero-fixture run as 0% agreement for both sides
 *     (never NaN) — a promotable verdict of `true` in that case (0 >= 0) is a
 *     degenerate-but-correct non-inferiority result, not a special case.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-040 §T3 D7, AC-ADF-7, AC-ADF-12
 */

/** The three coarse outcome buckets a fixture's judge run is classified into. */
export const GOLDEN_DIRECTION_LABELS = ["met", "partial", "not_met"] as const;

/** Derived TypeScript union for {@link GOLDEN_DIRECTION_LABELS}. */
export type GoldenDirectionLabel = (typeof GOLDEN_DIRECTION_LABELS)[number];

/**
 * Conservative-first tie-break ranking for {@link computeMajorityLabel} — lower rank
 * wins a tie. Mirrors the judge prompt's own instruction to "score unverifiable claims
 * conservatively (prefer a lower score over benefit-of-the-doubt)".
 */
const CONSERVATISM_RANK: Record<GoldenDirectionLabel, number> = {
  not_met: 0,
  partial: 1,
  met: 2,
};

/**
 * Map a raw `overall_score` (0-100) onto the coarse {@link GoldenDirectionLabel}
 * taxonomy. Boundary semantics: `>= 80` is "met" (inclusive), `< 40` is "not_met"
 * (exclusive upper bound at 40), everything else is "partial" — mirrors
 * `buildAssessPromptV6`'s rubric anchors without importing that module.
 *
 * @example
 * deriveGoldenDirectionLabel(88); // → "met"
 * deriveGoldenDirectionLabel(80); // → "met" (boundary, inclusive)
 * deriveGoldenDirectionLabel(62); // → "partial"
 * deriveGoldenDirectionLabel(39); // → "not_met"
 */
export function deriveGoldenDirectionLabel(overallScore: number): GoldenDirectionLabel {
  if (overallScore >= 80) return "met";
  if (overallScore < 40) return "not_met";
  return "partial";
}

/**
 * Deterministic majority vote over a non-empty array of direction labels (typically
 * N=3 scripted/live judge runs for one fixture, one prompt version). A genuine tie
 * (every distinct label present has the same count) resolves to the most conservative
 * label present in the tie set ({@link CONSERVATISM_RANK}), never an arbitrary
 * array-order pick.
 *
 * @param labels - Non-empty array of per-run direction labels
 * @returns The majority label, or the conservative tie-break winner
 * @throws {Error} if `labels` is empty — a caller bug (every fixture run must supply
 *   at least one label), not a runtime data-quality condition worth a Result/LoreError
 *   round-trip in this internal tooling module
 *
 * @example
 * computeMajorityLabel(["met", "met", "partial"]); // → "met"
 * computeMajorityLabel(["met", "partial", "not_met"]); // → "not_met" (3-way tie, conservative)
 */
export function computeMajorityLabel(labels: readonly GoldenDirectionLabel[]): GoldenDirectionLabel {
  if (labels.length === 0) {
    throw new Error("computeMajorityLabel: labels must be non-empty");
  }

  const counts = new Map<GoldenDirectionLabel, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

  let bestCount = 0;
  let tied: GoldenDirectionLabel[] = [];
  for (const label of GOLDEN_DIRECTION_LABELS) {
    const count = counts.get(label) ?? 0;
    if (count === 0) continue;
    if (count > bestCount) {
      bestCount = count;
      tied = [label];
    } else if (count === bestCount) {
      tied.push(label);
    }
  }

  if (tied.length === 1) {
    const [only] = tied;
    if (only !== undefined) return only;
  }

  // reason: genuine tie (>=2 labels share the max count) — resolve conservatively,
  // never by array/insertion order (module invariant).
  return tied.reduce((mostConservative, candidate) =>
    CONSERVATISM_RANK[candidate] < CONSERVATISM_RANK[mostConservative] ? candidate : mostConservative,
  );
}

/** One fixture's raw N-run label arrays for both prompt versions under comparison. */
export interface GoldenFixtureRun {
  fixtureName: string;
  expectedLabel: GoldenDirectionLabel;
  candidateLabels: readonly GoldenDirectionLabel[];
  incumbentLabels: readonly GoldenDirectionLabel[];
}

/** Per-fixture majority result — the computed majorities plus expected-label match. */
export interface GoldenFixtureMajority {
  fixtureName: string;
  expectedLabel: GoldenDirectionLabel;
  candidateMajority: GoldenDirectionLabel;
  incumbentMajority: GoldenDirectionLabel;
  candidateMatchesExpected: boolean;
  incumbentMatchesExpected: boolean;
}

/** Full aggregation result across every fixture in a golden run. */
export interface GoldenAggregationResult {
  fixtures: GoldenFixtureMajority[];
  /** Fraction (0-1) of fixtures where the candidate's majority matched the expected label. */
  candidateAgreement: number;
  /** Fraction (0-1) of fixtures where the incumbent's majority matched the expected label. */
  incumbentAgreement: number;
  /**
   * True iff `candidateAgreement >= incumbentAgreement` — non-inferiority, not strict
   * improvement. A tie (equal agreement) passes.
   */
  promotable: boolean;
}

/**
 * Aggregate per-fixture N-run label arrays into majority labels, expected-label
 * agreement rates for both prompt versions, and a promotability verdict.
 *
 * @param runs - One entry per fixture (each fixture's candidate/incumbent N-run labels)
 * @returns {@link GoldenAggregationResult} — a zero-fixture input yields 0% agreement on
 *   both sides (never NaN) and `promotable: true` (0 >= 0, a degenerate non-inferiority pass)
 *
 * @example
 * aggregateGoldenRun([
 *   { fixtureName: "clean", expectedLabel: "met",
 *     candidateLabels: ["met", "met", "met"], incumbentLabels: ["met", "partial", "met"] },
 * ]);
 * // → { fixtures: [...], candidateAgreement: 1, incumbentAgreement: 1, promotable: true }
 */
export function aggregateGoldenRun(runs: readonly GoldenFixtureRun[]): GoldenAggregationResult {
  const fixtures: GoldenFixtureMajority[] = runs.map((run) => {
    const candidateMajority = computeMajorityLabel(run.candidateLabels);
    const incumbentMajority = computeMajorityLabel(run.incumbentLabels);
    return {
      fixtureName: run.fixtureName,
      expectedLabel: run.expectedLabel,
      candidateMajority,
      incumbentMajority,
      candidateMatchesExpected: candidateMajority === run.expectedLabel,
      incumbentMatchesExpected: incumbentMajority === run.expectedLabel,
    };
  });

  const total = fixtures.length;
  const candidateAgreement =
    total === 0 ? 0 : fixtures.filter((f) => f.candidateMatchesExpected).length / total;
  const incumbentAgreement =
    total === 0 ? 0 : fixtures.filter((f) => f.incumbentMatchesExpected).length / total;

  return {
    fixtures,
    candidateAgreement,
    incumbentAgreement,
    promotable: candidateAgreement >= incumbentAgreement,
  };
}
