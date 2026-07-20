/**
 * @spec_ref BUG-012 audit (`@lore/core`'s staleness.ts)
 *
 * `selectProbeCandidates`'s `opts.limit` used to flow unchecked into
 * `Array.prototype.slice(0, opts.limit)` — a negative limit (e.g. `-1`) silently
 * DROPS candidates from the tail of the sorted pool instead of erroring (the exact
 * "no silent fallback" violation this project's discipline forbids), and a `NaN`
 * limit collapses to an always-empty result. This suite proves the fix: an illegal
 * `opts.limit` now throws a named, contextful `InvalidStalenessLimitError` instead
 * of silently misbehaving, while `limit: 0` (a legitimate "assemble the pool, return
 * no candidates" request) still succeeds.
 *
 * Test plan:
 *   HAPPY:      a valid positive limit returns the expected slice, unchanged
 *   NEGATIVE:   NaN / non-integer (fractional) limit throws InvalidStalenessLimitError
 *   BOUNDARY:   limit === 0 succeeds (legal); limit === -1 throws (BUG-012's exact
 *               repro — pre-fix this silently dropped the last candidate via
 *               `.slice(0, -1)` instead of returning zero-or-error)
 *   ERROR:      the thrown error carries a typed `context.limit` payload, not just
 *               a message string (typed-errors discipline)
 *   REGRESSION: `excluded_by_limit`/`total_candidates` accounting is untouched for
 *               legal limits
 */

import { describe, it, expect } from "vitest";
import { InvalidStalenessLimitError, selectProbeCandidates, type StalenessCandidateInput } from "@lore/core";

const NOW_ISO = "2026-07-20T00:00:00.000Z";

/** Three eligible knowledge docs at increasing priority (in_degree * age_days). */
function makeInputs(): StalenessCandidateInput[] {
  return [
    {
      id: "doc-low",
      type: "knowledge",
      updated_at: "2026-06-01T00:00:00.000Z", // 49 days old
      extra: {},
      deleted_at: null,
      in_degree: 1,
    },
    {
      id: "doc-mid",
      type: "knowledge",
      updated_at: "2026-05-01T00:00:00.000Z", // 80 days old
      extra: {},
      deleted_at: null,
      in_degree: 2,
    },
    {
      id: "doc-high",
      type: "knowledge",
      updated_at: "2026-04-01T00:00:00.000Z", // 110 days old
      extra: {},
      deleted_at: null,
      in_degree: 3,
    },
  ];
}

describe("selectProbeCandidates — opts.limit validation (BUG-012)", () => {
  describe("HAPPY", () => {
    it("a valid positive limit returns exactly that many top-priority candidates", () => {
      const result = selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: 2 });
      expect(result.candidates).toHaveLength(2);
      expect(result.total_candidates).toBe(3);
      expect(result.excluded_by_limit).toBe(1);
      // Highest priority (in_degree * age_days) first.
      expect(result.candidates[0]?.id).toBe("doc-high");
      expect(result.candidates[1]?.id).toBe("doc-mid");
    });

    it("limit >= pool size returns the whole pool with excluded_by_limit: 0", () => {
      const result = selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: 100 });
      expect(result.candidates).toHaveLength(3);
      expect(result.excluded_by_limit).toBe(0);
    });
  });

  describe("NEGATIVE — illegal limit throws instead of silently misbehaving", () => {
    it("throws InvalidStalenessLimitError for NaN (was: silently returns an empty candidate list)", () => {
      expect(() => selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: NaN })).toThrow(
        InvalidStalenessLimitError,
      );
    });

    it("throws InvalidStalenessLimitError for a fractional limit", () => {
      expect(() => selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: 1.5 })).toThrow(
        InvalidStalenessLimitError,
      );
    });
  });

  describe("BOUNDARY", () => {
    it("limit === 0 is legal — returns zero candidates, no throw", () => {
      const result = selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: 0 });
      expect(result.candidates).toEqual([]);
      expect(result.total_candidates).toBe(3);
      expect(result.excluded_by_limit).toBe(3);
    });

    it("limit === -1 throws — BUG-012's exact repro (pre-fix: .slice(0, -1) silently dropped the tail candidate instead of erroring)", () => {
      let caught: unknown;
      try {
        selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: -1 });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(InvalidStalenessLimitError);
    });

    it("limit === 1 (smallest legal positive value) returns exactly the top candidate", () => {
      const result = selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: 1 });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.id).toBe("doc-high");
    });
  });

  describe("ERROR — the thrown error carries a typed context payload", () => {
    it("context.limit is the exact offending value, not just embedded in the message string", () => {
      try {
        selectProbeCandidates(makeInputs(), NOW_ISO, { min_age_days: 0, limit: -1 });
        expect.unreachable("expected selectProbeCandidates to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidStalenessLimitError);
        const err = e as InvalidStalenessLimitError;
        expect(err.context).toEqual({ limit: -1 });
        expect(err.name).toBe("InvalidStalenessLimitError");
        expect(err.message).toContain("-1");
      }
    });
  });
});
