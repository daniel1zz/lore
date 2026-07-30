/**
 * RED unit suite for `buildBootstrapInjection` (SPEC-080 §Projection Contract,
 * §Public Interface, AC-080-1) — [Skill:test] T1. This suite is written BEFORE
 * `buildBootstrapInjection` / `bootstrapInjectionSchema` / `BootstrapInjectionBudgets`
 * exist in `packages/core/src/session.ts` (paired impl: [Skill:implement] T2). Every
 * test in this file is expected to fail at import time — `session.js` does not yet
 * export the names this file imports — never because of a fixture/assertion bug.
 *
 * Contract pinned here (SPEC-080 §Projection Contract):
 *   - literal payload key order: [resume_hint,] my_claims, active_sessions,
 *     armed_gates, root, pending_reviews, active_plans, latest_handoffs, corpus,
 *     omitted (+ budget_exceeded present-iff-true, ALWAYS last). `resume_hint`
 *     is present ONLY when the caller passes `seatScoped: true` — an ordinary
 *     session's default call omits it entirely
 *     (spec-session-start-handoff-neutrality D1, D2 — see the two HAPPY cases
 *     below, added by that follow-on task).
 *   - active_plans selection: ready>0 OR claimed>0, sorted last_activity_at desc,
 *     capped at maxActivePlans, drops counted in omitted.active_plans
 *   - armed_gates condensed to string[] of checkpoint names only
 *   - pending_reviews.slugs capped at maxPendingSlugs, count field untouched,
 *     drops counted in omitted.pending_slugs
 *   - latest_handoffs capped at maxHandoffs (newest first, upstream-sorted)
 *   - char-budget rule: applied AFTER count caps, on compact-serialized length;
 *     drops whole trailing entries (latest_handoffs first, then active_plans),
 *     incrementing omitted.budget_drops; NEVER a mid-JSON slice; both droppable
 *     arrays empty and still over -> budget_exceeded: true, payload intact
 *   - unknown report fields (OCP) appended between corpus and omitted, in
 *     original report order; omitted/budget_exceeded are ALWAYS the final keys
 *   - bootstrapInjectionSchema is the projection's OWN schema (never a patch on
 *     bootstrapReportSchema) and must round-trip every payload field losslessly
 *
 * Six-dimension coverage:
 *   HAPPY:      representative full report + default budgets {5,3,3,8000} ->
 *               literal key order, compact json; armed_gates condensation
 *   NEGATIVE:   dead plans (ready=0 AND claimed=0) excluded despite recency
 *   BOUNDARY:   7 actionable plans capped at 5; pending_reviews slugs capped at
 *               3 with count preserved; json exactly at charBudget (zero drops,
 *               no flag); one entry over (budget_drops=1); oversized single
 *               field with no droppable entries (budget_exceeded=true, payload
 *               intact); maxActivePlans=0; empty-corpus report
 *   ERROR:      bootstrapInjectionSchema round-trip; NEGATIVE control — a field
 *               present on the payload but absent from a cloned (`.omit`) schema
 *               vanishes on parse (pins the SPEC-042 active_sessions strip-hazard
 *               incident class; proves the round-trip test would actually catch it)
 *   STATE:      n/a at this layer (STATE-dimension omitted-plan-with-fresh-claim
 *               fixture belongs to [Skill:test] T5, session-service.test.ts, which
 *               observes projection-downstream-of-derivation across services)
 *   REGRESSION: n/a — this is a new module surface, nothing pre-existing to pin
 *
 * Source: SPEC-080 §Projection Contract, §Public Interface (TypeScript), §Test
 * Plan; task [Skill:test] T1 buildBootstrapInjection RED unit suite, AC-080-1.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildBootstrapInjection,
  bootstrapInjectionSchema,
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

const BASE_REPORT: BootstrapReport = {
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
};

// ─── HAPPY — field order, compact json, armed_gates condensation ─────────────

describe("SPEC-080 AC-080-1 HAPPY — buildBootstrapInjection field order + compaction", () => {
  it("HAPPY: representative report + default budgets, ordinary (non-seat) session -> literal key order minus resume_hint, compact json", () => {
    // spec-session-start-handoff-neutrality D1 — an ordinary session (no
    // `seatScoped` argument, defaults false) omits resume_hint entirely.
    // spec-context-provenance-injected-corpus-global-state-and-a D1 —
    // scope_declaration now leads unconditionally, before my_claims.
    const result = buildBootstrapInjection(BASE_REPORT, DEFAULT_BUDGETS);
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
      "omitted",
    ]);
    expect(result.payload).not.toHaveProperty("resume_hint");
    expect(result.json).not.toContain("resume_hint");
    expect(result.json).not.toContain("\n  ");
    expect(JSON.parse(result.json)).toEqual(result.payload);
  });

  it("HAPPY: seatScoped=true retains resume_hint immediately after the leading scope_declaration", () => {
    // spec-session-start-handoff-neutrality D2 — a seat-scoped session's hint
    // derives from the session's own worktree branch, not a corpus-wide
    // guess, so it survives untouched. spec-context-provenance-injected-corpus-global-state-and-a
    // D1 — scope_declaration still leads even the seat-scoped hint.
    const result = buildBootstrapInjection(BASE_REPORT, DEFAULT_BUDGETS, true);
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
      "omitted",
    ]);
    expect(result.payload.resume_hint).toEqual(BASE_REPORT.resume_hint);
    expect(result.json).not.toContain("\n  ");
    expect(JSON.parse(result.json)).toEqual(result.payload);
  });

  it("HAPPY: armed_gates condenses to a string[] of checkpoint names only", () => {
    const result = buildBootstrapInjection(BASE_REPORT, DEFAULT_BUDGETS);
    expect(result.payload.armed_gates).toEqual(["spec-create", "task-claim"]);
  });
});

// ─── NEGATIVE — dead plans excluded regardless of recency ────────────────────

describe("SPEC-080 AC-080-1 NEGATIVE — dead-plan exclusion", () => {
  it("NEGATIVE: a plan with ready=0 AND claimed=0 is excluded despite a recent last_activity_at, and counted in omitted.active_plans", () => {
    const deadPlan = mkPlan(99, { ready: 0, claimed: 0, last_activity_at: "2026-07-25T00:00:00.000Z" });
    const report: BootstrapReport = {
      ...BASE_REPORT,
      active_plans: [...BASE_REPORT.active_plans, deadPlan],
    };
    const result = buildBootstrapInjection(report, DEFAULT_BUDGETS);
    expect(result.payload.active_plans.some((p) => p.slug === "plan-99")).toBe(false);
    expect(result.payload.omitted.active_plans).toBe(1);
  });
});

// ─── BOUNDARY — count caps ─────────────────────────────────────────────────

describe("SPEC-080 AC-080-1 BOUNDARY — count caps", () => {
  it("BOUNDARY: 7 actionable plans capped at maxActivePlans=5 keep the 5 newest by last_activity_at, omitted.active_plans=2", () => {
    const plans = Array.from({ length: 7 }, (_, i) =>
      mkPlan(i, { ready: 1, last_activity_at: `2026-07-${String(10 + i).padStart(2, "0")}T00:00:00.000Z` }),
    );
    const report: BootstrapReport = { ...BASE_REPORT, active_plans: plans };
    const result = buildBootstrapInjection(report, DEFAULT_BUDGETS);
    expect(result.payload.active_plans).toHaveLength(5);
    expect(result.payload.active_plans.map((p) => p.slug)).toEqual([
      "plan-6",
      "plan-5",
      "plan-4",
      "plan-3",
      "plan-2",
    ]);
    expect(result.payload.omitted.active_plans).toBe(2);
  });

  it("BOUNDARY: pending_reviews.slugs capped at maxPendingSlugs, count field preserved, drops counted in omitted.pending_slugs", () => {
    const slugs = Array.from({ length: 10 }, (_, i) => `doc-${i}`);
    const report: BootstrapReport = { ...BASE_REPORT, pending_reviews: { count: 10, slugs } };
    const result = buildBootstrapInjection(report, { ...DEFAULT_BUDGETS, maxPendingSlugs: 3 });
    expect(result.payload.pending_reviews.slugs).toHaveLength(3);
    expect(result.payload.pending_reviews.count).toBe(10);
    expect(result.payload.omitted.pending_slugs).toBe(7);
  });

  it("BOUNDARY: maxActivePlans=0 excludes all plans, all actionable plans counted in omitted", () => {
    const result = buildBootstrapInjection(BASE_REPORT, { ...DEFAULT_BUDGETS, maxActivePlans: 0 });
    expect(result.payload.active_plans).toEqual([]);
    const actionableCount = BASE_REPORT.active_plans.filter(
      (p) => p.task_counts.ready > 0 || p.task_counts.claimed > 0,
    ).length;
    expect(result.payload.omitted.active_plans).toBe(actionableCount);
  });

  it("BOUNDARY: empty-corpus report -> valid payload, ledger all zeros, no budget_exceeded flag", () => {
    const result = buildBootstrapInjection(EMPTY_REPORT, DEFAULT_BUDGETS);
    expect(result.payload.omitted).toEqual({
      active_plans: 0,
      latest_handoffs: 0,
      pending_slugs: 0,
      budget_drops: 0,
    });
    expect(result.payload.root).toBeNull();
    expect(result.payload).not.toHaveProperty("budget_exceeded");
  });
});

// ─── BOUNDARY — char-budget rule ───────────────────────────────────────────

describe("SPEC-080 AC-080-1 BOUNDARY — char-budget rule", () => {
  it("BOUNDARY: json length exactly equal to charBudget -> zero drops, no budget_exceeded flag", () => {
    const probe = buildBootstrapInjection(BASE_REPORT, { ...DEFAULT_BUDGETS, charBudget: 999_999 });
    const exactBudget = probe.json.length;
    const result = buildBootstrapInjection(BASE_REPORT, { ...DEFAULT_BUDGETS, charBudget: exactBudget });
    expect(result.json.length).toBe(exactBudget);
    expect(result.payload.omitted.budget_drops).toBe(0);
    expect(result.payload).not.toHaveProperty("budget_exceeded");
  });

  it("BOUNDARY: one entry over budget drops exactly one handoff entry, json stays under budget", () => {
    const probe = buildBootstrapInjection(BASE_REPORT, { ...DEFAULT_BUDGETS, charBudget: 999_999 });
    const oneOver = probe.json.length - 1;
    const result = buildBootstrapInjection(BASE_REPORT, { ...DEFAULT_BUDGETS, charBudget: oneOver });
    expect(result.payload.omitted.budget_drops).toBe(1);
    expect(result.json.length).toBeLessThanOrEqual(oneOver);
  });

  it("BOUNDARY: single oversized field with active_plans/latest_handoffs already empty -> budget_exceeded=true, payload intact, no mid-JSON slice", () => {
    // reason: the huge value lives in `root.title` (a non-droppable field),
    // NOT `resume_hint` — an ordinary (non-seat-scoped) session omits
    // resume_hint from the payload entirely (spec-session-start-handoff-
    // neutrality D1), so it can no longer be the mechanism this BOUNDARY case
    // uses to force `budget_exceeded`.
    const hugeTitle = "x".repeat(20_000);
    const report: BootstrapReport = {
      ...BASE_REPORT,
      active_plans: [],
      latest_handoffs: [],
      root: { slug: "prd-root", title: hugeTitle },
    };
    const result = buildBootstrapInjection(report, { ...DEFAULT_BUDGETS, charBudget: 100 });
    expect(result.payload.budget_exceeded).toBe(true);
    expect(result.payload.root?.title).toBe(hugeTitle);
    // reason: the char-budget rule forbids a mid-JSON slice — the full oversized
    // value must survive intact in both the payload object and its serialization.
    expect(result.json).toContain(hugeTitle);
  });
});

// ─── OCP — unknown report field ────────────────────────────────────────────

describe("SPEC-080 AC-080-1 OCP — unknown report field placement", () => {
  it("OCP: an unknown report field is appended between corpus and omitted, in original order; omitted/budget_exceeded stay the final keys", () => {
    const reportWithUnknown = {
      ...BASE_REPORT,
      future_field: { some: "data" },
    } as unknown as BootstrapReport;
    const result = buildBootstrapInjection(reportWithUnknown, DEFAULT_BUDGETS);
    const keys = Object.keys(result.payload);
    const corpusIdx = keys.indexOf("corpus");
    const omittedIdx = keys.indexOf("omitted");
    const futureIdx = keys.indexOf("future_field");
    expect(futureIdx).toBeGreaterThan(-1);
    expect(futureIdx).toBeGreaterThan(corpusIdx);
    expect(futureIdx).toBeLessThan(omittedIdx);
    expect(keys[keys.length - 1]).toBe("omitted");
    expect((result.payload as unknown as { future_field: unknown }).future_field).toEqual({ some: "data" });
  });
});

// ─── ERROR — schema round-trip + strip-hazard negative control ────────────

describe("SPEC-080 AC-080-1 ERROR — bootstrapInjectionSchema round-trip + strip-hazard", () => {
  it("ERROR: bootstrapInjectionSchema round-trips every payload field losslessly", () => {
    const result = buildBootstrapInjection(BASE_REPORT, DEFAULT_BUDGETS);
    const parsed = bootstrapInjectionSchema.parse(result.payload);
    expect(parsed).toEqual(result.payload);
  });

  it("NEGATIVE control: a field present on the payload but missing from a cloned (.omit) schema silently vanishes on parse — pins the SPEC-042 active_sessions strip-hazard incident class and proves the round-trip test above would actually catch a regression", () => {
    const result = buildBootstrapInjection(BASE_REPORT, DEFAULT_BUDGETS);
    expect(result.payload).toHaveProperty("active_sessions");

    // reason: bootstrapInjectionSchema is expected to be a plain z.object() —
    // .omit() is the standard zod way to derive "the same shape minus one key"
    // without hand-maintaining a duplicate field list (mirrors the
    // bootstrapReportSchema strip-hazard precedent in session-registry.test.ts).
    const strippedSchema = (bootstrapInjectionSchema as unknown as { omit: (mask: Record<string, true>) => z.ZodTypeAny }).omit({
      active_sessions: true,
    });
    const parsed = strippedSchema.parse(result.payload) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("active_sessions");
  });
});
