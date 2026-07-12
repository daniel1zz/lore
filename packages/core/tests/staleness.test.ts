/**
 * Six-dimension tests for the staleness-probe pure layer (SPEC-044 §Design Decisions
 * D1, D2, D5) — `selectProbeCandidates`, `computeStalenessPriority`,
 * `stalenessVerdictSchema`, `mapStalenessVerdictDecisionToJudgmentDecision`.
 *
 * Dimension mapping:
 *   HAPPY:      priority = in_degree * age_days; deterministic sort order; verdict
 *               schema accepts a well-formed holds/stale_candidate payload
 *   NEGATIVE:   type filter excludes non-knowledge/adr; soft-deleted excluded;
 *               invalidated-at-injected-now excluded; verdict schema rejects an
 *               out-of-enum decision, a stale_candidate with empty blocking_questions,
 *               and a holds with non-empty blocking_questions
 *   BOUNDARY:   age_days === min_age_days is INCLUDED (inclusive lower bound);
 *               in_degree === 0 is included at priority 0, sorted LAST among positive
 *               scores; limit === pool size and limit > pool size both return the
 *               whole pool with excluded_by_limit === 0; superseded_candidate.reason
 *               at exactly 200 chars accepted, 201 rejected
 *   ERROR:      n/a — this module has no IO/throw surface; Zod safeParse never throws
 *   STATE:      lastConfirmedAt resets ordering when a later "holds" probe exists (an
 *               older doc with a recent holds probe drops in priority vs. one without)
 *   REGRESSION: tiebreak (same priority) sorts by lastConfirmedAt ASC then id ASC,
 *               deterministically, across repeated calls on the same input
 *
 * @spec_ref SPEC-044 §Design Decisions D1, D2, D5; AC-SP-1
 */

import { describe, it, expect } from "vitest";
import {
  computeStalenessPriority,
  mapStalenessVerdictDecisionToJudgmentDecision,
  selectProbeCandidates,
  stalenessVerdictSchema,
  type StalenessCandidateInput,
} from "../src/staleness.js";

const NOW = "2026-07-12T00:00:00.000Z";

function daysAgoIso(days: number): string {
  return new Date(new Date(NOW).getTime() - days * 86_400_000).toISOString();
}

function makeInput(overrides: Partial<StalenessCandidateInput> = {}): StalenessCandidateInput {
  return {
    id: "01ARZ3DOC00000000000001",
    type: "knowledge",
    updated_at: daysAgoIso(30),
    extra: {},
    deleted_at: null,
    in_degree: 2,
    ...overrides,
  };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — computeStalenessPriority / selectProbeCandidates", () => {
  it("priority = in_degree * age_days", () => {
    expect(computeStalenessPriority({ in_degree: 3, age_days: 20 })).toBe(60);
    expect(computeStalenessPriority({ in_degree: 0, age_days: 200 })).toBe(0);
  });

  it("returns candidates sorted DESC by priority, carrying in_degree/age_days/last_confirmed_at/priority", () => {
    const inputs = [
      makeInput({ id: "01ARZ3DOCLOWPRIORITY0001", in_degree: 1, updated_at: daysAgoIso(20) }), // priority 20
      makeInput({ id: "01ARZ3DOCHIGHPRIORITY001", in_degree: 5, updated_at: daysAgoIso(20) }), // priority 100
    ];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 10 });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.id).toBe("01ARZ3DOCHIGHPRIORITY001");
    expect(result.candidates[0]?.priority).toBe(100);
    expect(result.candidates[0]?.in_degree).toBe(5);
    expect(result.candidates[0]?.age_days).toBe(20);
    expect(result.candidates[1]?.id).toBe("01ARZ3DOCLOWPRIORITY0001");
    expect(result.total_candidates).toBe(2);
    expect(result.excluded_by_limit).toBe(0);
    expect(result.skipped).toEqual({ invalidated: 0, too_young: 0 });
  });

  it("stalenessVerdictSchema accepts a well-formed 'holds' payload", () => {
    const parsed = stalenessVerdictSchema.safeParse({
      decision: "holds",
      confidence: 0.9,
      reasons: ["still accurate"],
      blocking_questions: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("stalenessVerdictSchema accepts a well-formed 'stale_candidate' payload with superseded_candidate", () => {
    const parsed = stalenessVerdictSchema.safeParse({
      decision: "stale_candidate",
      confidence: 0.6,
      reasons: ["the linked API changed shape"],
      blocking_questions: ["has this been re-confirmed?"],
      superseded_candidate: { ref: "knowledge-newer-doc", reason: "supersedes this finding" },
    });
    expect(parsed.success).toBe(true);
  });

  it("mapStalenessVerdictDecisionToJudgmentDecision maps holds->approve and stale_candidate->escalate", () => {
    expect(mapStalenessVerdictDecisionToJudgmentDecision("holds")).toBe("approve");
    expect(mapStalenessVerdictDecisionToJudgmentDecision("stale_candidate")).toBe("escalate");
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — selection filters each provably exclude", () => {
  it("excludes a doc whose type is not knowledge/adr", () => {
    const inputs = [makeInput({ id: "01ARZ3DOCSPECTYPE000001", type: "spec" })];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 10 });
    expect(result.candidates).toHaveLength(0);
    expect(result.total_candidates).toBe(0);
  });

  it("excludes a soft-deleted doc", () => {
    const inputs = [makeInput({ id: "01ARZ3DOCDELETED0000001", deleted_at: daysAgoIso(1) })];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 10 });
    expect(result.candidates).toHaveLength(0);
  });

  it("excludes an invalidated doc (isInvalidated true at injected nowIso) and counts it in skipped.invalidated", () => {
    const inputs = [
      makeInput({
        id: "01ARZ3DOCINVALID0000001",
        extra: { validity: { invalid_at: daysAgoIso(5) } },
      }),
    ];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 10 });
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped.invalidated).toBe(1);
  });

  it("stalenessVerdictSchema rejects an out-of-enum decision", () => {
    const parsed = stalenessVerdictSchema.safeParse({
      decision: "maybe",
      confidence: 0.5,
      reasons: [],
      blocking_questions: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("stalenessVerdictSchema rejects decision='stale_candidate' with EMPTY blocking_questions", () => {
    const parsed = stalenessVerdictSchema.safeParse({
      decision: "stale_candidate",
      confidence: 0.5,
      reasons: ["hmm"],
      blocking_questions: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("stalenessVerdictSchema rejects decision='holds' with NON-EMPTY blocking_questions", () => {
    const parsed = stalenessVerdictSchema.safeParse({
      decision: "holds",
      confidence: 0.5,
      reasons: ["fine"],
      blocking_questions: ["but what about X?"],
    });
    expect(parsed.success).toBe(false);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — age_days boundary, in_degree=0, limit edges, superseded_candidate.reason cap", () => {
  it("age_days === min_age_days is INCLUDED (inclusive lower bound, T11)", () => {
    const inputs = [makeInput({ id: "01ARZ3DOCEXACTLY14DAYS01", updated_at: daysAgoIso(14) })];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 10 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.age_days).toBe(14);
  });

  it("age_days === min_age_days - 1 is EXCLUDED, counted in skipped.too_young", () => {
    const inputs = [makeInput({ id: "01ARZ3DOC13DAYSTOOYOUNG1", updated_at: daysAgoIso(13) })];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 10 });
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped.too_young).toBe(1);
  });

  it("in_degree === 0 is INCLUDED at priority 0, sorted LAST among positive-priority candidates", () => {
    const inputs = [
      makeInput({ id: "01ARZ3DOCORPHANZERODEG01", in_degree: 0, updated_at: daysAgoIso(999) }),
      makeInput({ id: "01ARZ3DOCPOSITIVEDEGREE1", in_degree: 1, updated_at: daysAgoIso(20) }),
    ];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 10 });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.id).toBe("01ARZ3DOCPOSITIVEDEGREE1");
    expect(result.candidates[1]?.id).toBe("01ARZ3DOCORPHANZERODEG01");
    expect(result.candidates[1]?.priority).toBe(0);
  });

  it("limit === pool size returns the whole pool with excluded_by_limit === 0", () => {
    const inputs = [makeInput({ id: "01ARZ3DOCPOOLSIZEONE0001" })];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.excluded_by_limit).toBe(0);
  });

  it("limit > pool size returns the whole pool with excluded_by_limit === 0 (T12)", () => {
    const inputs = [makeInput({ id: "01ARZ3DOCPOOLSIZEONE0002" })];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 999 });
    expect(result.candidates).toHaveLength(1);
    expect(result.excluded_by_limit).toBe(0);
  });

  it("limit < pool size trims the tail and reports excluded_by_limit accurately", () => {
    const inputs = [
      makeInput({ id: "01ARZ3DOCPOOLA0000000001", in_degree: 3, updated_at: daysAgoIso(20) }),
      makeInput({ id: "01ARZ3DOCPOOLB0000000002", in_degree: 2, updated_at: daysAgoIso(20) }),
      makeInput({ id: "01ARZ3DOCPOOLC0000000003", in_degree: 1, updated_at: daysAgoIso(20) }),
    ];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 14, limit: 2 });
    expect(result.candidates).toHaveLength(2);
    expect(result.total_candidates).toBe(3);
    expect(result.excluded_by_limit).toBe(1);
  });

  it("superseded_candidate.reason at exactly 200 chars is accepted, 201 is rejected", () => {
    const at200 = "x".repeat(200);
    const at201 = "x".repeat(201);
    expect(
      stalenessVerdictSchema.safeParse({
        decision: "stale_candidate",
        confidence: 0.5,
        reasons: ["r"],
        blocking_questions: ["q"],
        superseded_candidate: { ref: "some-doc", reason: at200 },
      }).success,
    ).toBe(true);
    expect(
      stalenessVerdictSchema.safeParse({
        decision: "stale_candidate",
        confidence: 0.5,
        reasons: ["r"],
        blocking_questions: ["q"],
        superseded_candidate: { ref: "some-doc", reason: at201 },
      }).success,
    ).toBe(false);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — lastConfirmedAt resets ordering (D2)", () => {
  it("a doc with a RECENT holds-probe drops in priority vs. an equally-old doc with no probe", () => {
    // Both docs were last edited 100 days ago (same raw age), but doc A has a holds
    // probe from 10 days ago — its effective age_days should be ~10, not ~100.
    const inputs = [
      makeInput({
        id: "01ARZ3DOCRECENTHOLDS0001",
        in_degree: 2,
        updated_at: daysAgoIso(100),
        latest_holds_probe_at: daysAgoIso(10),
      }),
      makeInput({
        id: "01ARZ3DOCNOPROBEEVER0001",
        in_degree: 2,
        updated_at: daysAgoIso(100),
      }),
    ];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 0, limit: 10 });
    const recent = result.candidates.find((c) => c.id === "01ARZ3DOCRECENTHOLDS0001")!;
    const never = result.candidates.find((c) => c.id === "01ARZ3DOCNOPROBEEVER0001")!;
    expect(recent.age_days).toBe(10);
    expect(never.age_days).toBe(100);
    expect(recent.priority).toBeLessThan(never.priority);
    // The never-probed doc, being older-effective, sorts FIRST (higher priority).
    expect(result.candidates[0]?.id).toBe("01ARZ3DOCNOPROBEEVER0001");
  });

  it("last_confirmed_at reported on the candidate matches the resolved holds-probe timestamp, not updated_at", () => {
    const holdsAt = daysAgoIso(10);
    const inputs = [
      makeInput({ id: "01ARZ3DOCCONFIRMEDAT0001", updated_at: daysAgoIso(100), latest_holds_probe_at: holdsAt }),
    ];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 0, limit: 10 });
    expect(result.candidates[0]?.last_confirmed_at).toBe(holdsAt);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — deterministic tiebreak (same priority -> lastConfirmedAt ASC -> id ASC)", () => {
  it("two candidates with IDENTICAL priority sort by lastConfirmedAt ASC (chronologically earlier/older timestamp first)", () => {
    // "20-days-ago" is chronologically EARLIER (smaller timestamp) than "10-days-ago" —
    // that's the "older" (ASC-first) one under the tiebreak rule.
    const inputs = [
      makeInput({ id: "01ARZ3DOCTIEBREAK20AGO01", in_degree: 1, updated_at: daysAgoIso(20) }),
      makeInput({ id: "01ARZ3DOCTIEBREAK10AGO01", in_degree: 2, updated_at: daysAgoIso(10) }),
    ];
    // priorities: 20-days-ago = 1*20=20, 10-days-ago = 2*10=20 -- tied.
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 0, limit: 10 });
    expect(result.candidates[0]?.priority).toBe(result.candidates[1]?.priority);
    expect(result.candidates[0]?.id).toBe("01ARZ3DOCTIEBREAK20AGO01");
    expect(result.candidates[1]?.id).toBe("01ARZ3DOCTIEBREAK10AGO01");
  });

  it("two candidates with IDENTICAL priority AND lastConfirmedAt sort by id ASC (lexicographic)", () => {
    const sharedUpdatedAt = daysAgoIso(20);
    const inputs = [
      makeInput({ id: "01ZZZDOCLAST0000000000001", in_degree: 1, updated_at: sharedUpdatedAt }),
      makeInput({ id: "01AAADOCFIRST000000000001", in_degree: 1, updated_at: sharedUpdatedAt }),
    ];
    const result = selectProbeCandidates(inputs, NOW, { min_age_days: 0, limit: 10 });
    expect(result.candidates[0]?.id).toBe("01AAADOCFIRST000000000001");
    expect(result.candidates[1]?.id).toBe("01ZZZDOCLAST0000000000001");
  });

  it("repeated calls on the SAME input produce the IDENTICAL order every time (no hidden nondeterminism)", () => {
    const inputs = [
      makeInput({ id: "01ARZ3DOCREPEATA00000001", in_degree: 3, updated_at: daysAgoIso(15) }),
      makeInput({ id: "01ARZ3DOCREPEATB00000002", in_degree: 1, updated_at: daysAgoIso(45) }),
      makeInput({ id: "01ARZ3DOCREPEATC00000003", in_degree: 2, updated_at: daysAgoIso(20) }),
    ];
    const first = selectProbeCandidates(inputs, NOW, { min_age_days: 0, limit: 10 }).candidates.map((c) => c.id);
    const second = selectProbeCandidates(inputs, NOW, { min_age_days: 0, limit: 10 }).candidates.map((c) => c.id);
    expect(first).toEqual(second);
  });
});
