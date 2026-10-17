/**
 * AC-080-1 (spec-080-bootstrap-injection-projection-tier-1-tier-2-payload): the
 * `buildBootstrapInjection` contract that survived the seat-only redesign
 * (4b515543): field order, the exact char-budget boundary (payload intact, never
 * sliced), no count caps left to apply, a report with nothing personal injects
 * nothing, report fields outside the closed allowlist never reach the payload, and
 * the strict schema round-trip with its strip-hazard negative.
 *
 * Six-dimension coverage:
 *   HAPPY:      field order of a full payload; schema round-trip
 *   NEGATIVE:   empty-corpus report yields null; a payload with an extra key is rejected
 *   BOUNDARY:   charBudget == length (no flag) vs length - 1 (flag, payload intact); oversized single field
 *   ERROR:      strict schema strip-hazard (unknown key must throw, not be stripped)
 *   STATE:      legacy count knobs (maxActivePlans: 0) change nothing
 *   REGRESSION: an unknown report field is never injected
 *
 * The retired halves of the original criterion (count caps 5/3/3, the omitted ledger)
 * have no behaviour left to test: those fields are no longer injected.
 */

import { describe, expect, it } from "vitest";
import {
  bootstrapInjectionSchema,
  buildBootstrapInjection,
  type BootstrapInjectionSeat,
  type BootstrapReport,
  type BootstrapSeatClaim,
} from "../../src/session.js";

const EMPTY_CORPUS_REPORT: BootstrapReport = {
  root: null,
  active_plans: [],
  pending_reviews: { count: 0, slugs: [] },
  my_claims: [],
  armed_gates: [],
  latest_handoffs: [],
  resume_hint: null,
  corpus: { total_docs: 0, last_updated: null },
  active_sessions: [],
  archive_candidates: 0,
} as unknown as BootstrapReport;

const FULL_REPORT: BootstrapReport = {
  ...EMPTY_CORPUS_REPORT,
  resume_hint: { plan_slug: "plan-a", handoff_slug: "handoff-1" },
} as unknown as BootstrapReport;

const CLAIM: BootstrapSeatClaim = {
  task_slug: "task-seat",
  plan_slug: "plan-a",
  claimed_at: "2026-10-11T03:00:00.000Z",
  stale: false,
};

const SEAT: BootstrapInjectionSeat = { branch: "feat-x", worktree: "/w", planResolved: true, claims: [CLAIM] };

describe("AC-080-1 buildBootstrapInjection contract", () => {
  it("HAPPY: key order is scope_declaration, resume_hint, seat_claims", () => {
    const r = buildBootstrapInjection({ report: FULL_REPORT, seat: SEAT }, { charBudget: 8000 });
    expect(Object.keys(r.payload ?? {})).toEqual(["scope_declaration", "resume_hint", "seat_claims"]);
    expect(JSON.parse(r.json)).toEqual(r.payload);
  });

  it("BOUNDARY: charBudget exactly at the compact length sets no flag; one below sets budget_exceeded with the payload intact", () => {
    const base = buildBootstrapInjection({ report: FULL_REPORT, seat: SEAT }, { charBudget: 8000 });
    const len = base.json.length;
    const atCap = buildBootstrapInjection({ report: FULL_REPORT, seat: SEAT }, { charBudget: len });
    expect(atCap.payload).not.toHaveProperty("budget_exceeded");
    expect(atCap.json).toBe(base.json);
    const over = buildBootstrapInjection({ report: FULL_REPORT, seat: SEAT }, { charBudget: len - 1 });
    expect(over.payload).toMatchObject({ budget_exceeded: true, seat_claims: [CLAIM], resume_hint: FULL_REPORT.resume_hint });
    expect(Object.keys(over.payload ?? {}).at(-1)).toBe("budget_exceeded");
  });

  it("BOUNDARY: an oversized single field still returns the payload intact with budget_exceeded true", () => {
    const big: BootstrapSeatClaim = { ...CLAIM, task_slug: "t".repeat(5000) };
    const r = buildBootstrapInjection(
      { report: EMPTY_CORPUS_REPORT, seat: { ...SEAT, planResolved: false, claims: [big] } },
      { charBudget: 100 },
    );
    expect(r.payload?.budget_exceeded).toBe(true);
    expect(r.payload?.seat_claims[0]?.task_slug).toHaveLength(5000);
  });

  it("NEGATIVE: an empty-corpus report injects nothing, for a main checkout and for a seat with nothing personal", () => {
    expect(buildBootstrapInjection({ report: EMPTY_CORPUS_REPORT, seat: null }, { charBudget: 8000 })).toEqual({ payload: null, json: "" });
    const seatNothing: BootstrapInjectionSeat = { ...SEAT, claims: [] };
    expect(buildBootstrapInjection({ report: EMPTY_CORPUS_REPORT, seat: seatNothing }, { charBudget: 8000 })).toEqual({ payload: null, json: "" });
  });

  it("STATE: legacy count knobs (maxActivePlans: 0) change nothing; there are no count caps left to apply", () => {
    const plain = buildBootstrapInjection({ report: FULL_REPORT, seat: SEAT }, { charBudget: 8000 });
    const legacy = buildBootstrapInjection(
      { report: FULL_REPORT, seat: SEAT },
      { charBudget: 8000, maxActivePlans: 0, maxHandoffs: 0, maxPendingSlugs: 0 } as unknown as { charBudget: number },
    );
    expect(legacy).toEqual(plain);
  });

  it("REGRESSION: an unknown report field never appears in the payload", () => {
    const report = { ...FULL_REPORT, zz_future_field: { leak: true } } as unknown as BootstrapReport;
    const r = buildBootstrapInjection({ report, seat: SEAT }, { charBudget: 8000 });
    expect(r.json).not.toContain("zz_future_field");
    expect(Object.keys(r.payload ?? {})).not.toContain("zz_future_field");
  });

  it("HAPPY + ERROR: the payload round-trips the strict schema, and a payload with an extra key throws instead of being stripped", () => {
    const r = buildBootstrapInjection({ report: FULL_REPORT, seat: SEAT }, { charBudget: 8000 });
    expect(bootstrapInjectionSchema.parse(JSON.parse(r.json))).toEqual(r.payload);
    expect(() => bootstrapInjectionSchema.parse({ ...JSON.parse(r.json), zz_extra: 1 })).toThrow();
  });
});
