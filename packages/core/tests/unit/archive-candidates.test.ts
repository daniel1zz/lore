/**
 * Tests for @lore/core archive-candidates — computeArchiveCandidates (R2/R3/R4
 * sweep rule engine) and computePlanCloseCascadeTargets (R1 cascade rule).
 * Pure functions, no IO. Spec-first: assertions come from
 * spec-lifecycle-archival-plan-close-cascade-deterministic §Candidate Rules
 * R1-R4 — not from reading the implementation body first.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      R2 superseded_handoff, R3 expired_handoff, R4 done_plan_straggler
 *               each independently flag exactly the doc the rule describes;
 *               computePlanCloseCascadeTargets archives an unclaimed task + a
 *               plan-parented handoff
 *   NEGATIVE:   exclusions — knowledge non-handoff sub_types (retro), adr, spec,
 *               plan docs are NEVER candidates even when their "parent plan" is
 *               archived / they are old; a fresh-claimed task is excluded from
 *               R4 AND from the cascade's toArchive (reported in `skipped` instead)
 *   BOUNDARY:   R3 age exactly equal to handoff_ttl_minutes is NOT a candidate
 *               (strict `>`); a doc already `archived`/`deprecated` is never
 *               re-reported by any rule
 *   ERROR:      malformed `extra` (claim wrong shape, handoff extra missing
 *               required fields) is tolerated — never throws, degrades to "not
 *               a candidate under that rule" rather than crashing
 *   STATE:      a 3-handoff supersession chain for the same (plan, actor) pair
 *               produces exactly 2 superseded_handoff candidates (never a
 *               double-count, never counting the newest)
 *   REGRESSION: an empty corpus produces `[]`; computeArchiveCandidates never
 *               mutates its `docs` input
 *
 * @spec_ref spec-lifecycle-archival-plan-close-cascade-deterministic
 *   §Candidate Rules R1-R4, AC-097-1
 */

import { describe, it, expect } from "vitest";
import { computeArchiveCandidates, computePlanCloseCascadeTargets } from "../../src/archive-candidates.js";
import type { DocId, DocRecord, DocType } from "../../src/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): DocId {
  _seq += 1;
  return `01HARCH${String(_seq).padStart(19, "0")}`;
}

function makeDoc(type: DocType, extra: unknown = {}, overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId();
  const base = {
    id,
    slug: `${type}-fixture-${id.slice(-6)}`,
    type,
    role: "plan",
    title: `${type} ${id}`,
    status: "draft",
    priority: "medium",
    content: "Fixture body",
    parent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
    ...overrides,
  };
  return base as unknown as DocRecord;
}

function handoffDoc(
  planId: DocId | null,
  by: string,
  createdAt: string,
  overrides: Partial<DocRecord> = {},
): DocRecord {
  return makeDoc(
    "knowledge",
    {
      sub_type: "handoff",
      handoff: { by, task_refs: [], modified_files: [], key_decisions: [], next_steps: ["do the thing"] },
    },
    { parent_id: planId, created_at: createdAt, ...overrides },
  );
}

function taskDoc(planId: DocId, overrides: Partial<DocRecord> = {}): DocRecord {
  return makeDoc("task", {}, { parent_id: planId, ...overrides });
}

const DEFAULT_TTL = { handoffTtlMinutes: 10080, claimTtlMinutes: 120 };
const NOW = "2026-07-27T00:00:00.000Z";

function freshClaim(by = "agent:t") {
  return { claim: { by, at: "2026-07-26T23:00:00.000Z" } }; // 60m ago, well under 120m TTL
}

function staleClaim(by = "agent:t") {
  return { claim: { by, at: "2026-07-01T00:00:00.000Z" } }; // long expired
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("computeArchiveCandidates — HAPPY", () => {
  it("R2: a strictly older handoff in a 2-member (plan,actor) group is superseded_handoff", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const older = handoffDoc(plan.id, "alice", "2026-07-01T00:00:00.000Z");
    const newer = handoffDoc(plan.id, "alice", "2026-07-10T00:00:00.000Z");
    const candidates = computeArchiveCandidates([plan, older, newer], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc_id).toBe(older.id);
    expect(candidates[0]!.rule).toBe("superseded_handoff");
    expect(candidates[0]!.reason).toContain(newer.slug);
  });

  it("R3: a planless handoff older than handoff_ttl_minutes is expired_handoff", () => {
    // 10081 minutes ago — one minute past the 10080 default TTL.
    const old = handoffDoc(null, "alice", "2026-07-19T23:59:00.000Z");
    const candidates = computeArchiveCandidates([old], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc_id).toBe(old.id);
    expect(candidates[0]!.rule).toBe("expired_handoff");
  });

  it("R4: a task under an archived plan with no claim at all is done_plan_straggler", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const task = taskDoc(plan.id);
    const candidates = computeArchiveCandidates([plan, task], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc_id).toBe(task.id);
    expect(candidates[0]!.rule).toBe("done_plan_straggler");
  });

  it("computePlanCloseCascadeTargets archives an unclaimed task and a plan-parented handoff", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const task = taskDoc(plan.id);
    const handoff = handoffDoc(plan.id, "alice", "2026-07-20T00:00:00.000Z");
    const result = computePlanCloseCascadeTargets([task, handoff], NOW, 120);
    expect(result.skipped).toEqual([]);
    expect(result.toArchive).toHaveLength(2);
    expect(result.toArchive.map((t) => t.doc_id).sort()).toEqual([task.id, handoff.id].sort());
    const taskTarget = result.toArchive.find((t) => t.doc_id === task.id);
    const handoffTarget = result.toArchive.find((t) => t.doc_id === handoff.id);
    expect(taskTarget?.kind).toBe("task");
    expect(handoffTarget?.kind).toBe("handoff");
  });
});

// ─── NEGATIVE (exclusions) ──────────────────────────────────────────────────

describe("computeArchiveCandidates — NEGATIVE exclusions", () => {
  it("a knowledge doc with sub_type 'retro' under an archived plan is never a candidate", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const retro = makeDoc("knowledge", { sub_type: "retro" }, { parent_id: plan.id, created_at: "2026-01-01T00:00:00.000Z" });
    expect(computeArchiveCandidates([plan, retro], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("an adr under an archived plan is never a candidate", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const adr = makeDoc("adr", { decision_status: "accepted" }, { parent_id: plan.id, created_at: "2026-01-01T00:00:00.000Z" });
    expect(computeArchiveCandidates([plan, adr], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("a spec under an archived plan is never a candidate", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const spec = makeDoc("spec", {}, { parent_id: plan.id, created_at: "2026-01-01T00:00:00.000Z" });
    expect(computeArchiveCandidates([plan, spec], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("a plan doc itself is never a candidate, regardless of age", () => {
    const otherPlan = makeDoc("plan", {}, { status: "archived", created_at: "2020-01-01T00:00:00.000Z" });
    expect(computeArchiveCandidates([otherPlan], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("a fresh-claimed task under an archived plan is excluded from R4", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const task = taskDoc(plan.id, { extra: freshClaim() });
    expect(computeArchiveCandidates([plan, task], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("computePlanCloseCascadeTargets skips a fresh-claimed task and names it in skipped[]", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const task = taskDoc(plan.id, { extra: freshClaim("agent:holder") });
    const result = computePlanCloseCascadeTargets([task], NOW, 120);
    expect(result.toArchive).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.doc_id).toBe(task.id);
    expect(result.skipped[0]!.reason).toContain("agent:holder");
  });

  it("a STALE-claimed task under an archived plan IS a done_plan_straggler (claim expired)", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const task = taskDoc(plan.id, { extra: staleClaim() });
    const candidates = computeArchiveCandidates([plan, task], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.rule).toBe("done_plan_straggler");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("computeArchiveCandidates — BOUNDARY", () => {
  it("R3: age exactly equal to handoff_ttl_minutes is NOT a candidate (strict >)", () => {
    // Exactly 10080 minutes before NOW.
    const exact = handoffDoc(null, "alice", "2026-07-20T00:00:00.000Z");
    expect(computeArchiveCandidates([exact], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("R3: age one minute past handoff_ttl_minutes IS a candidate", () => {
    const pastByOne = handoffDoc(null, "alice", "2026-07-19T23:59:00.000Z");
    const candidates = computeArchiveCandidates([pastByOne], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.rule).toBe("expired_handoff");
  });

  it("an already-archived handoff is never re-reported even if it would otherwise match R3", () => {
    const doneHandoff = handoffDoc(null, "alice", "2020-01-01T00:00:00.000Z", { status: "archived" });
    expect(computeArchiveCandidates([doneHandoff], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("an already-archived task under an archived plan is never re-reported by R4", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const doneTask = taskDoc(plan.id, { status: "archived" });
    expect(computeArchiveCandidates([plan, doneTask], NOW, DEFAULT_TTL)).toEqual([]);
  });
});

// ─── ERROR (malformed extra tolerated) ─────────────────────────────────────

describe("computeArchiveCandidates — ERROR tolerance", () => {
  it("a task with a malformed claim (wrong shape) does not throw and is treated as unclaimed", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const task = taskDoc(plan.id, { extra: { claim: "not-an-object" } });
    expect(() => computeArchiveCandidates([plan, task], NOW, DEFAULT_TTL)).not.toThrow();
    const candidates = computeArchiveCandidates([plan, task], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.rule).toBe("done_plan_straggler");
  });

  it("a knowledge doc with sub_type 'handoff' but a missing required handoff field never throws and is not a candidate", () => {
    const malformed = makeDoc(
      "knowledge",
      { sub_type: "handoff", handoff: { by: "alice" } }, // missing next_steps (min 1) — Zod-invalid
      { created_at: "2000-01-01T00:00:00.000Z" },
    );
    expect(() => computeArchiveCandidates([malformed], NOW, DEFAULT_TTL)).not.toThrow();
    expect(computeArchiveCandidates([malformed], NOW, DEFAULT_TTL)).toEqual([]);
  });
});

// ─── STATE (supersession chain) ─────────────────────────────────────────────

describe("computeArchiveCandidates — STATE", () => {
  it("a 3-handoff chain for the same (plan, actor) produces exactly 2 superseded_handoff candidates", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const h1 = handoffDoc(plan.id, "alice", "2026-07-01T00:00:00.000Z");
    const h2 = handoffDoc(plan.id, "alice", "2026-07-10T00:00:00.000Z");
    const h3 = handoffDoc(plan.id, "alice", "2026-07-20T00:00:00.000Z");
    const candidates = computeArchiveCandidates([plan, h1, h2, h3], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.rule === "superseded_handoff")).toBe(true);
    expect(candidates.map((c) => c.doc_id).sort()).toEqual([h1.id, h2.id].sort());
  });

  it("a different actor's handoff on the same plan does not join the group", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const alice1 = handoffDoc(plan.id, "alice", "2026-07-01T00:00:00.000Z");
    const bob1 = handoffDoc(plan.id, "bob", "2026-07-02T00:00:00.000Z");
    expect(computeArchiveCandidates([plan, alice1, bob1], NOW, DEFAULT_TTL)).toEqual([]);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("computeArchiveCandidates — REGRESSION", () => {
  it("an empty corpus produces []", () => {
    expect(computeArchiveCandidates([], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("never mutates its docs input", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const task = taskDoc(plan.id);
    const docs = [plan, task];
    const snapshot = JSON.parse(JSON.stringify(docs));
    computeArchiveCandidates(docs, NOW, DEFAULT_TTL);
    expect(JSON.parse(JSON.stringify(docs))).toEqual(snapshot);
  });
});

describe("computePlanCloseCascadeTargets — REGRESSION", () => {
  it("empty children produces empty toArchive/skipped", () => {
    expect(computePlanCloseCascadeTargets([], NOW, 120)).toEqual({ toArchive: [], skipped: [] });
  });
});
