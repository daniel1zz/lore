/**
 * @layer core-unit (buildBootstrapInjection; the AC's oracle is the compiled-binary e2e)
 * Unit suite for the seat-only `buildBootstrapInjection` projection
 * (spec-session-start-injection-carries-only-the-session-s-own, AC-SI-1).
 *
 * Contract pinned here: the injection carries ONLY the seat's own open items
 * (unfinished seat claims + the seat plan's resume_hint) and is `null`
 * otherwise. Corpus-global report fields never enter the payload.
 *
 * Six-dimension coverage:
 *   HAPPY:      (b) claim-only seat, (c) plan-with-handoff seat
 *   NEGATIVE:   (a) main checkout -> null, (d) nothing personal -> null, (h) planResolved but no hint -> null
 *   BOUNDARY:   (e) charBudget below payload -> budget_exceeded, payload intact, nothing sliced
 *   ERROR:      (f) strict schema rejects corpus-global keys
 *   STATE:      (a) report carries resume_hint + my_claims but seat === null -> still null
 *   REGRESSION: (g) constants wording + closed key allowlist
 */

import { describe, it, expect, vi } from "vitest";
import { resolveBootstrapInjectionBudgets, type LoreConfig } from "../../src/config.js";
import {
  BOOTSTRAP_CORPUS_GLOBAL_KEYS,
  BOOTSTRAP_FRAMING_LINE,
  BOOTSTRAP_INJECTED_KEYS,
  BOOTSTRAP_SCOPE_DECLARATION,
  bootstrapInjectionSchema,
  buildBootstrapInjection,
  type BootstrapReport,
  type BootstrapSeatClaim,
} from "../../src/session.js";

const BUSY_REPORT: BootstrapReport = {
  root: { slug: "baseline-root", title: "Root" },
  active_plans: [
    {
      slug: "plan-a",
      title: "Plan A",
      task_counts: { ready: 2, claimed: 1, done: 0 },
      last_activity_at: "2026-10-11T00:00:00.000Z",
    },
  ],
  pending_reviews: { count: 266, slugs: ["doc-a", "doc-b", "doc-c"] },
  my_claims: [{ task_slug: "task-1", plan_slug: "plan-a", claimed_at: "2026-10-11T00:00:00.000Z", stale: false }],
  armed_gates: [{ checkpoint: "spec-create", feeding_source_slug: null }],
  latest_handoffs: [{ plan_slug: "plan-a", handoff_slug: "handoff-1", by: "agent:x", at: "2026-10-11T01:00:00.000Z" }],
  resume_hint: { plan_slug: "plan-a", handoff_slug: "handoff-1" },
  corpus: { total_docs: 42, last_updated: "2026-10-11T02:00:00.000Z" },
  active_sessions: [],
  archive_candidates: 14,
};

const NO_HINT_REPORT: BootstrapReport = { ...BUSY_REPORT, resume_hint: null };

const CLAIM: BootstrapSeatClaim = {
  task_slug: "task-seat",
  plan_slug: "plan-a",
  claimed_at: "2026-10-11T03:00:00.000Z",
  stale: false,
};

const BUDGETS = { charBudget: 8000 };

describe("AC-SI-1 buildBootstrapInjection — seat-only projection", () => {
  it("(a) seat=null with a report full of global state -> payload null, json ''", () => {
    const result = buildBootstrapInjection({ report: BUSY_REPORT, seat: null }, BUDGETS);
    expect(result.payload).toBeNull();
    expect(result.json).toBe("");
  });

  it("(b) seat with one claim, planResolved=false -> keys [scope_declaration, seat_claims]", () => {
    const result = buildBootstrapInjection(
      { report: BUSY_REPORT, seat: { branch: "worktree-agent-1", worktree: "/w", planResolved: false, claims: [CLAIM] } },
      BUDGETS,
    );
    expect(result.payload).not.toBeNull();
    expect(Object.keys(result.payload ?? {})).toEqual(["scope_declaration", "seat_claims"]);
    expect(result.payload?.seat_claims).toEqual([CLAIM]);
    expect(JSON.parse(result.json)).toEqual(result.payload);
  });

  it("(c) planResolved with non-null resume_hint and no claims -> [scope_declaration, resume_hint, seat_claims]", () => {
    const result = buildBootstrapInjection(
      { report: BUSY_REPORT, seat: { branch: "plan/plan-a", worktree: "/w", planResolved: true, claims: [] } },
      BUDGETS,
    );
    expect(Object.keys(result.payload ?? {})).toEqual(["scope_declaration", "resume_hint", "seat_claims"]);
    expect(result.payload?.resume_hint).toEqual({ plan_slug: "plan-a", handoff_slug: "handoff-1" });
    expect(result.payload?.seat_claims).toEqual([]);
  });

  it("(d) seat with no claims and planResolved=false -> null", () => {
    const result = buildBootstrapInjection(
      { report: BUSY_REPORT, seat: { branch: "x", worktree: "/w", planResolved: false, claims: [] } },
      BUDGETS,
    );
    expect(result.payload).toBeNull();
    expect(result.json).toBe("");
  });

  it("(e) charBudget below payload length -> budget_exceeded true, payload intact", () => {
    const result = buildBootstrapInjection(
      { report: BUSY_REPORT, seat: { branch: "x", worktree: "/w", planResolved: false, claims: [CLAIM] } },
      { charBudget: 5 },
    );
    expect(result.payload?.budget_exceeded).toBe(true);
    expect(result.payload?.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);
    expect(result.payload?.seat_claims).toEqual([CLAIM]);
    expect(JSON.parse(result.json)).toEqual(result.payload);
  });

  it("(e2) a payload within budget carries no budget_exceeded key", () => {
    const result = buildBootstrapInjection(
      { report: BUSY_REPORT, seat: { branch: "x", worktree: "/w", planResolved: false, claims: [CLAIM] } },
      BUDGETS,
    );
    expect("budget_exceeded" in (result.payload ?? {})).toBe(false);
  });

  it("(f) strict schema rejects a payload carrying my_claims or pending_reviews", () => {
    const base = { scope_declaration: BOOTSTRAP_SCOPE_DECLARATION, seat_claims: [] };
    expect(bootstrapInjectionSchema.safeParse(base).success).toBe(true);
    expect(bootstrapInjectionSchema.safeParse({ ...base, my_claims: [] }).success).toBe(false);
    expect(
      bootstrapInjectionSchema.safeParse({ ...base, pending_reviews: { count: 0, slugs: [] } }).success,
    ).toBe(false);
  });

  it("(g) constants: scope declaration names this worktree + not-included; framing names pull commands; key sets disjoint", () => {
    const lower = BOOTSTRAP_SCOPE_DECLARATION.toLowerCase();
    expect(lower).toContain("this worktree");
    expect(lower).toContain("not included");
    expect(lower).not.toContain("corpus-global");
    expect(lower).not.toContain("every plan");
    expect(BOOTSTRAP_FRAMING_LINE).toContain("lore bootstrap");
    expect(BOOTSTRAP_FRAMING_LINE).toContain("lore ready");
    expect(BOOTSTRAP_FRAMING_LINE).toContain("lore pending");
    expect(BOOTSTRAP_FRAMING_LINE.toLowerCase()).not.toContain("corpus-global");

    const result = buildBootstrapInjection(
      { report: BUSY_REPORT, seat: { branch: "plan/plan-a", worktree: "/w", planResolved: true, claims: [CLAIM] } },
      BUDGETS,
    );
    expect(result.payload?.scope_declaration).toBe(BOOTSTRAP_SCOPE_DECLARATION);
    for (const key of Object.keys(result.payload ?? {})) {
      expect(BOOTSTRAP_INJECTED_KEYS.has(key)).toBe(true);
      expect(BOOTSTRAP_CORPUS_GLOBAL_KEYS.has(key)).toBe(false);
    }
    expect([...BOOTSTRAP_INJECTED_KEYS]).toEqual(["scope_declaration", "resume_hint", "seat_claims", "budget_exceeded"]);
  });

  it("(h) planResolved=true but resume_hint=null and no claims -> null", () => {
    const result = buildBootstrapInjection(
      { report: NO_HINT_REPORT, seat: { branch: "plan/plan-a", worktree: "/w", planResolved: true, claims: [] } },
      BUDGETS,
    );
    expect(result.payload).toBeNull();
    expect(result.json).toBe("");
  });

  it("STATE: planResolved=false never emits resume_hint even when the report carries one (BR-326)", () => {
    const result = buildBootstrapInjection(
      { report: BUSY_REPORT, seat: { branch: "x", worktree: "/w", planResolved: false, claims: [CLAIM] } },
      BUDGETS,
    );
    expect("resume_hint" in (result.payload ?? {})).toBe(false);
  });

  it("REGRESSION: corpus-global key set is exactly the nine pull-only report fields", () => {
    expect([...BOOTSTRAP_CORPUS_GLOBAL_KEYS].sort()).toEqual(
      [
        "active_plans",
        "active_sessions",
        "archive_candidates",
        "armed_gates",
        "corpus",
        "latest_handoffs",
        "pending_reviews",
        "root",
        "strategy",
      ].sort(),
    );
  });
});

describe("AC-SI-4 retired bootstrap_injection knobs (D5)", () => {
  it("ERROR: each SET retired key warns exactly once per process; char_budget is the only live knob; an unset key never warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // reason: the resolver reads only `workflow.bootstrap_injection`; a partial cast avoids a full config fixture.
      const config = {
        workflow: { bootstrap_injection: { max_active_plans: 2, max_handoffs: 1, char_budget: 4000 } },
      } as unknown as LoreConfig;
      expect(resolveBootstrapInjectionBudgets(config)).toEqual({ charBudget: 4000 });
      expect(resolveBootstrapInjectionBudgets(config)).toEqual({ charBudget: 4000 });
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => l.includes("max_active_plans"))).toHaveLength(1);
      expect(lines.filter((l) => l.includes("max_handoffs"))).toHaveLength(1);
      expect(lines.filter((l) => l.includes("max_pending_slugs"))).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("BOUNDARY: no config at all resolves the schema default and never warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(resolveBootstrapInjectionBudgets(undefined)).toEqual({ charBudget: 8000 });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
