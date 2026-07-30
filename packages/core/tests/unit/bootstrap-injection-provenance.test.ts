/**
 * RED-then-GREEN unit suite for the D1 leading `scope_declaration` field,
 * plus the 5 exported provenance constants —
 * spec-context-provenance-injected-corpus-global-state-and-a (v38, corrected),
 * task task-t1-core-constants-leading-scope-field-in (T1), AC-CP-1 / AC-CP-2.
 *
 * CORRECTED (v38): D1's original short-circuit — discarding every other
 * field once the declaration alone approached `budgets.charBudget` — was a
 * spec defect. It contradicted SPEC-080(bootstrap-injection)'s own
 * char-budget rule ("payload returned INTACT" on an unmeetable budget) at
 * field granularity instead of character granularity, and it fired on ANY
 * `char_budget` below the declaration's length regardless of the actual
 * report's size (`char_budget` is `positive()` with no floor — a reachable
 * config). There is NO short-circuit: `scope_declaration` leads
 * unconditionally, participates in the char measurement like every other
 * field, is never a drop candidate, and an unmeetable budget still returns
 * the FULL payload intact with `budget_exceeded: true` — SPEC-080's
 * pre-existing rule, unchanged. AC-CP-2's fixture (below) now pins SPEC-080's
 * own construction: both droppable arrays empty + one oversized field.
 *
 * D6 discipline (binding on this file): no assertion here keys off a
 * remembered substring. Every assertion is either `===`/`toBe` identity
 * against an exported constant, or exhaustive iteration over an exported
 * array/set (`REQUIRED_DISCLAIMER_TOKENS`, `BOOTSTRAP_INJECTION_KNOWN_KEYS`).
 *
 * Six-dimension coverage:
 *   HAPPY:      leading key + identity (AC-CP-1); seatScoped ordering;
 *               the three sibling-consumed constants are well-formed
 *   NEGATIVE:   empty-corpus report still leads with the declaration;
 *               negative control proving `.toContain` actually discriminates
 *   BOUNDARY:   AC-CP-2 — oversized field + empty droppable arrays against an
 *               unmeetable budget; a companion test proves there is no
 *               threshold effect at the declaration's own length (the exact
 *               regression the v38 spec correction targets)
 *   ERROR:      bootstrapInjectionSchema accepts+round-trips the ordinary
 *               shape; a second case proves the schema is now GAP-FREE — it
 *               also accepts the over-budget-and-intact shape, since there is
 *               no narrower shape left for it to reject
 *   STATE:      purity — repeated calls are byte-identical, no mutation of
 *               the shared constants across calls
 *   REGRESSION: an ordinary in-budget projection's pre-existing field order
 *               (now led by scope_declaration) and omitted accounting are
 *               unchanged from the pre-D1 SPEC-080 contract
 *
 * Source: spec-context-provenance-injected-corpus-global-state-and-a §Design
 * Decisions D1, D6; task task-t1-core-constants-leading-scope-field-in.
 */

import { describe, it, expect } from "vitest";
import {
  buildBootstrapInjection,
  bootstrapInjectionSchema,
  BOOTSTRAP_SCOPE_DECLARATION,
  REQUIRED_DISCLAIMER_TOKENS,
  BOOTSTRAP_FRAMING_LINE,
  RESUME_SCOPE_CLOSURE,
  SOURCE_CATEGORY_TOKENS,
  BOOTSTRAP_INJECTION_KNOWN_KEYS,
  type BootstrapInjectionBudgets,
} from "../../src/session.js";
import type { BootstrapReport } from "../../src/session.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** One `active_plans[]` entry. `ready`/`claimed` default to "actionable" (ready:1). */
function mkPlan(
  i: number,
  opts: Partial<{ ready: number; claimed: number; done: number; last_activity_at: string }> = {},
) {
  return {
    slug: `plan-${i}`,
    title: `Plan ${i}`,
    task_counts: {
      ready: opts.ready ?? 1,
      claimed: opts.claimed ?? 0,
      done: opts.done ?? 0,
    },
    last_activity_at: opts.last_activity_at ?? `2026-07-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
  };
}

const DEFAULT_BUDGETS: BootstrapInjectionBudgets = {
  maxActivePlans: 5,
  maxHandoffs: 3,
  maxPendingSlugs: 3,
  charBudget: 8000,
};

/** A full-field `BootstrapReport` — every field populated, per AC-CP-2's own fixture recipe. */
const FULL_REPORT: BootstrapReport = {
  root: { slug: "prd-root", title: "Root PRD" },
  active_plans: [
    mkPlan(1, { ready: 2, claimed: 1, last_activity_at: "2026-07-20T00:00:00.000Z" }),
    mkPlan(2, { ready: 1, claimed: 0, last_activity_at: "2026-07-19T00:00:00.000Z" }),
  ],
  pending_reviews: { count: 2, slugs: ["doc-a", "doc-b"] },
  my_claims: [{ task_slug: "task-1", plan_slug: "plan-1", claimed_at: "2026-07-20T00:00:00.000Z", stale: false }],
  armed_gates: [
    { checkpoint: "spec-create", feeding_source_slug: "skill-lore-design" },
    { checkpoint: "task-claim", feeding_source_slug: null },
  ],
  latest_handoffs: [
    { plan_slug: "plan-1", handoff_slug: "handoff-1", by: "agent:x", at: "2026-07-20T01:00:00.000Z" },
  ],
  resume_hint: { plan_slug: "plan-1", handoff_slug: "handoff-1" },
  corpus: { total_docs: 42, last_updated: "2026-07-20T02:00:00.000Z" },
  active_sessions: [
    {
      by: "agent:x",
      machine: "hostA",
      worktree: "/w1",
      branches: ["b1"],
      task_slugs: ["task-1"],
      newest_at: "2026-07-20T00:00:00.000Z",
    },
  ],
  archive_candidates: 3,
};

const EMPTY_REPORT: BootstrapReport = {
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
};

const STANDARD_OMITTED_KEYS = ["active_plans", "latest_handoffs", "pending_slugs", "budget_drops"];

// ─── AC-CP-1 HAPPY — leading scope_declaration ───────────────────────────────

describe("AC-CP-1 HAPPY — leading scope_declaration", () => {
  it("HAPPY AC-CP-1: first key of the injection payload is the scope declaration by identity, and every REQUIRED_DISCLAIMER_TOKENS member is contained in it", () => {
    const result = buildBootstrapInjection(FULL_REPORT, DEFAULT_BUDGETS);

    expect(Object.keys(result.payload)[0]).toBe("scope_declaration");
    expect(result.payload.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);

    for (const token of REQUIRED_DISCLAIMER_TOKENS) {
      expect(BOOTSTRAP_SCOPE_DECLARATION).toContain(token);
    }
  });

  it("HAPPY: seatScoped=true keeps resume_hint immediately after scope_declaration, not before it", () => {
    const result = buildBootstrapInjection(FULL_REPORT, DEFAULT_BUDGETS, true);
    expect(Object.keys(result.payload)).toEqual([
      "scope_declaration",
      "resume_hint",
      "my_claims",
      "active_sessions",
      "armed_gates",
      "root",
      "pending_reviews",
      "active_plans",
      "latest_handoffs",
      "corpus",
      "archive_candidates",
      "omitted",
    ]);
  });
});

describe("HAPPY — sibling-consumed constants (T2/T3/T4) are exported and well-formed", () => {
  it("HAPPY: BOOTSTRAP_FRAMING_LINE is a non-empty single-line string for T2's binary-side stdout", () => {
    expect(typeof BOOTSTRAP_FRAMING_LINE).toBe("string");
    expect(BOOTSTRAP_FRAMING_LINE.length).toBeGreaterThan(0);
    expect(BOOTSTRAP_FRAMING_LINE).not.toContain("\n");
  });

  it("HAPPY: RESUME_SCOPE_CLOSURE names every BOOTSTRAP_INJECTION_KNOWN_KEYS member for T3's scope-closure block", () => {
    expect(BOOTSTRAP_INJECTION_KNOWN_KEYS.size).toBeGreaterThan(0);
    for (const key of BOOTSTRAP_INJECTION_KNOWN_KEYS) {
      expect(RESUME_SCOPE_CLOSURE).toContain(key);
    }
  });

  it("HAPPY: SOURCE_CATEGORY_TOKENS carries exactly the three source categories for T4's governance rule", () => {
    expect(SOURCE_CATEGORY_TOKENS).toEqual(["pasted ticket", "session-start injection", "this-turn query"]);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE", () => {
  it("NEGATIVE: an empty-corpus report still leads with scope_declaration and an all-zero omitted ledger", () => {
    const result = buildBootstrapInjection(EMPTY_REPORT, DEFAULT_BUDGETS);
    expect(Object.keys(result.payload)[0]).toBe("scope_declaration");
    expect(result.payload.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);
    expect(result.payload.omitted).toEqual({
      active_plans: 0,
      latest_handoffs: 0,
      pending_slugs: 0,
      budget_drops: 0,
    });
    expect(result.payload).not.toHaveProperty("budget_exceeded");
  });

  it("NEGATIVE control: a phrase never promised by any REQUIRED_DISCLAIMER_TOKENS member is correctly absent from the declaration — proves the .toContain assertions above actually discriminate", () => {
    expect(BOOTSTRAP_SCOPE_DECLARATION).not.toContain("some unrelated phrase that was never promised");
  });
});

// ─── AC-CP-2 BOUNDARY — unmeetable budget, payload returned intact (no short-circuit) ──

describe("AC-CP-2 BOUNDARY — unmeetable budget, payload returned intact", () => {
  it("BOUNDARY budget-exceeded: oversized field with both droppable arrays empty exceeds the budget -> budget_exceeded true, EVERY data field intact, declaration present and unsliced at position 1, ledger never naming the declaration", () => {
    // reason: SPEC-080(bootstrap-injection)'s own pinned construction (v38
    // spec correction) — a report whose droppable arrays (active_plans,
    // latest_handoffs) are already empty, carrying one oversized field
    // (root.title), projected against a budget it structurally cannot meet.
    const hugeTitle = "x".repeat(20_000);
    const report: BootstrapReport = {
      ...FULL_REPORT,
      active_plans: [],
      latest_handoffs: [],
      root: { slug: "prd-root", title: hugeTitle },
    };
    const result = buildBootstrapInjection(report, { ...DEFAULT_BUDGETS, charBudget: 100 });

    expect(result.payload.budget_exceeded).toBe(true);

    // Declaration: present, unsliced, still leading.
    expect(Object.keys(result.payload)[0]).toBe("scope_declaration");
    expect(result.payload.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);
    expect(result.json).toContain(BOOTSTRAP_SCOPE_DECLARATION);

    // EVERY other data field intact — SPEC-080's "never sacrifice content
    // for budget" rule, NOT the retired D1 short-circuit that discarded them.
    expect(result.payload.my_claims).toEqual(report.my_claims);
    expect(result.payload.active_sessions).toEqual(report.active_sessions);
    expect(result.payload.armed_gates).toEqual(["spec-create", "task-claim"]);
    expect(result.payload.root).toEqual({ slug: "prd-root", title: hugeTitle });
    expect(result.json).toContain(hugeTitle);
    expect(result.payload.pending_reviews).toEqual({ count: 2, slugs: ["doc-a", "doc-b"] });
    expect(result.payload.active_plans).toEqual([]);
    expect(result.payload.latest_handoffs).toEqual([]);
    expect(result.payload.corpus).toEqual(report.corpus);
    expect(result.payload.archive_candidates).toBe(3);

    // Omission ledger: only the 4 pre-existing SPEC-080 counters — never a
    // field naming the declaration.
    expect(Object.keys(result.payload.omitted)).toEqual(STANDARD_OMITTED_KEYS);
  });

  it("BOUNDARY: a charBudget below the declaration's own length triggers NO special case — same exhaust-then-flag pipeline as any other tiny budget, never an annihilated payload", () => {
    // reason: this is the EXACT regression the v38 spec correction targets —
    // this charBudget value used to trip the retired degenerate short-circuit
    // and discard every field but the declaration. It must now behave
    // identically to any other unmeetable budget: drop handoffs, then plans,
    // then flag — nothing else is ever removed.
    const result = buildBootstrapInjection(FULL_REPORT, {
      ...DEFAULT_BUDGETS,
      charBudget: BOOTSTRAP_SCOPE_DECLARATION.length - 1,
    });
    expect(result.payload.latest_handoffs).toEqual([]);
    expect(result.payload.active_plans).toEqual([]);
    expect(result.payload.budget_exceeded).toBe(true);
    expect(result.payload).toHaveProperty("my_claims");
    expect(result.payload).toHaveProperty("root");
    expect(result.payload).toHaveProperty("archive_candidates");
    expect(result.payload.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);
  });
});

// ─── ERROR — schema acceptance, no accepted gap ──────────────────────────────

describe("ERROR — bootstrapInjectionSchema (truthful contract, gap-free)", () => {
  it("ERROR: bootstrapInjectionSchema accepts and round-trips the ordinary-shape payload including the new required scope_declaration field", () => {
    const result = buildBootstrapInjection(FULL_REPORT, DEFAULT_BUDGETS);
    const parsed = bootstrapInjectionSchema.parse(result.payload);
    expect(parsed).toEqual(result.payload);
    expect(parsed.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);
  });

  it("ERROR: bootstrapInjectionSchema also accepts the over-budget-and-intact payload — there is no longer any shape buildBootstrapInjection returns that this schema rejects", () => {
    const hugeTitle = "x".repeat(20_000);
    const report: BootstrapReport = {
      ...FULL_REPORT,
      active_plans: [],
      latest_handoffs: [],
      root: { slug: "prd-root", title: hugeTitle },
    };
    const result = buildBootstrapInjection(report, { ...DEFAULT_BUDGETS, charBudget: 100 });
    const parsed = bootstrapInjectionSchema.safeParse(result.payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(result.payload);
    }
  });
});

// ─── STATE — purity ───────────────────────────────────────────────────────────

describe("STATE — purity across repeated calls", () => {
  it("STATE: two calls with identical report and budgets produce byte-identical json, and REQUIRED_DISCLAIMER_TOKENS is never mutated across calls", () => {
    const tokensBefore = [...REQUIRED_DISCLAIMER_TOKENS];
    const first = buildBootstrapInjection(FULL_REPORT, DEFAULT_BUDGETS);
    const second = buildBootstrapInjection(FULL_REPORT, DEFAULT_BUDGETS);
    expect(second.json).toBe(first.json);
    expect([...REQUIRED_DISCLAIMER_TOKENS]).toEqual(tokensBefore);
  });
});

// ─── REGRESSION — pre-existing SPEC-080 contract unchanged besides the new leading key ──

describe("REGRESSION — pre-existing field order + omitted accounting unchanged", () => {
  it("REGRESSION: ordinary in-budget projection keeps the pre-existing field order (now led by scope_declaration) and omitted accounting unchanged", () => {
    const result = buildBootstrapInjection(FULL_REPORT, DEFAULT_BUDGETS);
    expect(Object.keys(result.payload)).toEqual([
      "scope_declaration",
      "my_claims",
      "active_sessions",
      "armed_gates",
      "root",
      "pending_reviews",
      "active_plans",
      "latest_handoffs",
      "corpus",
      "archive_candidates",
      "omitted",
    ]);
    expect(result.payload.omitted).toEqual({
      active_plans: 0,
      latest_handoffs: 0,
      pending_slugs: 0,
      budget_drops: 0,
    });
    expect(result.payload).not.toHaveProperty("budget_exceeded");
    expect(result.payload.armed_gates).toEqual(["spec-create", "task-claim"]);
  });

  it("REGRESSION: a dead plan (ready=0 AND claimed=0) is still excluded despite recency, counted in omitted.active_plans, unaffected by the new leading field", () => {
    const deadPlan = mkPlan(99, { ready: 0, claimed: 0, last_activity_at: "2026-07-25T00:00:00.000Z" });
    const report: BootstrapReport = {
      ...FULL_REPORT,
      active_plans: [...FULL_REPORT.active_plans, deadPlan],
    };
    const result = buildBootstrapInjection(report, DEFAULT_BUDGETS);
    expect(result.payload.active_plans.some((p) => p.slug === "plan-99")).toBe(false);
    expect(result.payload.omitted.active_plans).toBe(1);
    expect(Object.keys(result.payload)[0]).toBe("scope_declaration");
  });
});
