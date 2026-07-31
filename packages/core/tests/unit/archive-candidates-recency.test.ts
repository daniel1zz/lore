/**
 * Tests for @lore/core archive-candidates R2's RECENCY GUARD —
 * `computeArchiveCandidates` must not propose a superseded handoff that is
 * still young enough to belong to a live session.
 *
 * Spec-first: every assertion comes from
 * spec-superseded-handoff-archival-has-no-recency-guard §Decisions D1-D4 and
 * AC-R2-1..AC-R2-4 — not from reading the implementation body.
 *
 * Measured defect this file pins (2026-07-31): R2 grouped by
 * `[parent_id, handoff.by]` and flagged every non-newest group member with NO
 * age condition, so writing a handoff as `agent:main-orchestrator` made a
 * concurrently-live session's ticket an instant `superseded_handoff` candidate.
 *
 * The load-bearing assertion is the NEGATIVE one (AC-R2-1). A test that only
 * checks the old-enough case passes against the defective behaviour, which
 * flagged regardless of age.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      an old superseded handoff under an ACTIVE parent plan is still
 *               reported as `superseded_handoff` (AC-R2-3 — R2 does not
 *               collapse into R3, which never touches an active plan)
 *   NEGATIVE:   a superseded handoff YOUNGER than handoffTtlMinutes yields ZERO
 *               candidates under any rule (AC-R2-1)
 *   BOUNDARY:   age exactly == handoffTtlMinutes is NOT a candidate (strict `>`,
 *               the same comparison R3 uses — D1 one threshold, two rules);
 *               one minute past IS
 *   ERROR:      the guard reads the SUPERSEDED doc's age, never the superseding
 *               doc's (AC-R2-2 / D2) — reading the wrong one inverts the
 *               protection while still passing the young case
 *   STATE:      a 3-handoff chain whose members straddle the TTL flags only the
 *               old member — pins per-doc age evaluation, not a group-wide
 *               oldest/newest age
 *   REGRESSION: R2 keeps precedence over R3 for attribution (D3) — a doc
 *               satisfying BOTH rules is reported exactly once, naming
 *               supersession
 *
 * @spec_ref spec-superseded-handoff-archival-has-no-recency-guard
 *   §Decisions D1-D4, AC-R2-1, AC-R2-2, AC-R2-3
 */

import { describe, it, expect } from "vitest";
import { computeArchiveCandidates } from "../../src/archive-candidates.js";
import type { DocId, DocRecord, DocType } from "../../src/types.js";

// ─── Fixtures (pure DocRecords — the function under test injects nowIso/TTLs) ──

let _seq = 0;

function nextId(): DocId {
  _seq += 1;
  return `01HRCNC${String(_seq).padStart(19, "0")}`;
}

function makeDoc(type: DocType, extra: unknown = {}, overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId();
  const base = {
    id,
    slug: `${type}-recency-${id.slice(-6)}`,
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

const DEFAULT_TTL = { handoffTtlMinutes: 10080, claimTtlMinutes: 120 };
const NOW = "2026-07-27T00:00:00.000Z";

/** Exactly `handoffTtlMinutes` (10080m = 7d) before {@link NOW} — the strict-`>` boundary. */
const AGE_EXACTLY_TTL = "2026-07-20T00:00:00.000Z";
/** One minute PAST the TTL — the first age that may be swept. */
const AGE_TTL_PLUS_1M = "2026-07-19T23:59:00.000Z";
/** One minute SHORT of the TTL — still protected. */
const AGE_TTL_MINUS_1M = "2026-07-20T00:01:00.000Z";
/** A day old — unambiguously inside the protected window. */
const AGE_1_DAY = "2026-07-26T00:00:00.000Z";
/** Twelve hours old — younger than {@link AGE_1_DAY}, so it supersedes it. */
const AGE_12_HOURS = "2026-07-26T12:00:00.000Z";
/** 26 days old — unambiguously past the TTL. */
const AGE_26_DAYS = "2026-07-01T00:00:00.000Z";

// ─── NEGATIVE — AC-R2-1 (load-bearing) ──────────────────────────────────────

describe("computeArchiveCandidates R2 recency guard — NEGATIVE (AC-R2-1)", () => {
  it("a young superseded handoff is not a candidate — a live session's ticket never reaches the sweep", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const older = handoffDoc(plan.id, "agent:main-orchestrator", AGE_1_DAY);
    const newer = handoffDoc(plan.id, "agent:main-orchestrator", AGE_12_HOURS);

    const candidates = computeArchiveCandidates([plan, older, newer], NOW, DEFAULT_TTL);

    // ZERO superseded_handoff candidates — the whole measurement (spec §AC).
    expect(candidates.filter((c) => c.rule === "superseded_handoff")).toEqual([]);
    // And it must not leak out under any OTHER rule either.
    expect(candidates.map((c) => c.doc_id)).not.toContain(older.id);
    expect(candidates).toEqual([]);
  });

  it("a young superseded handoff is not a candidate when it is PLANLESS either (the degenerate actor-only grouping)", () => {
    // Planless handoffs all carry the root PRD as parent_id, so the R2 key
    // degenerates to actor alone — exactly the measured collision case.
    const root = makeDoc("prd", {}, { status: "active" });
    const older = handoffDoc(root.id, "agent:main-orchestrator", AGE_1_DAY);
    const newer = handoffDoc(root.id, "agent:main-orchestrator", AGE_12_HOURS);

    expect(computeArchiveCandidates([root, older, newer], NOW, DEFAULT_TTL)).toEqual([]);
  });
});

// ─── ERROR (inverted-comparison detector) — AC-R2-2 / D2 ────────────────────

describe("computeArchiveCandidates R2 recency guard — D2 age source (AC-R2-2)", () => {
  it("the guard reads the superseded docs age, never the superseding docs age (D2)", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    // OLD superseded doc (26 days) paired with a newer handoff written RIGHT NOW
    // (age 0). Reading the superseding doc's age would skip this and report
    // zero — inverting the protection while still passing AC-R2-1.
    const oldSuperseded = handoffDoc(plan.id, "agent:main-orchestrator", AGE_26_DAYS);
    const freshlyWritten = handoffDoc(plan.id, "agent:main-orchestrator", NOW);

    const candidates = computeArchiveCandidates([plan, oldSuperseded, freshlyWritten], NOW, DEFAULT_TTL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc_id).toBe(oldSuperseded.id);
    expect(candidates[0]!.rule).toBe("superseded_handoff");
    // The superseding doc is never itself a candidate.
    expect(candidates.map((c) => c.doc_id)).not.toContain(freshlyWritten.id);
  });
});

// ─── HAPPY / R2-vs-R3 distinctness — AC-R2-3 / D3 ───────────────────────────

describe("computeArchiveCandidates R2 recency guard — rule distinctness (AC-R2-3)", () => {
  it("R2 stays distinct from R3: an old superseded handoff under an ACTIVE plan is still reported as superseded_handoff", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const older = handoffDoc(plan.id, "alice", AGE_26_DAYS);
    const newer = handoffDoc(plan.id, "alice", AGE_TTL_MINUS_1M);

    const candidates = computeArchiveCandidates([plan, older, newer], NOW, DEFAULT_TTL);

    // R3 requires planless-or-plan-terminal, so it can NEVER produce this doc —
    // if the guard had collapsed R2 into R3, the result would be empty.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc_id).toBe(older.id);
    expect(candidates[0]!.rule).toBe("superseded_handoff");
    expect(candidates[0]!.reason).toContain("superseded");
    expect(candidates[0]!.reason).toContain(newer.slug);
  });
});

// ─── BOUNDARY — D1 (one threshold, the same strict `>` R3 uses) ─────────────

describe("computeArchiveCandidates R2 recency guard — BOUNDARY", () => {
  it("R2: superseded age exactly equal to handoff_ttl_minutes is NOT a candidate (strict >, same as R3)", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const exact = handoffDoc(plan.id, "alice", AGE_EXACTLY_TTL);
    const newer = handoffDoc(plan.id, "alice", AGE_12_HOURS);

    expect(computeArchiveCandidates([plan, exact, newer], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("R2: superseded age one minute past handoff_ttl_minutes IS a candidate", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const pastByOne = handoffDoc(plan.id, "alice", AGE_TTL_PLUS_1M);
    const newer = handoffDoc(plan.id, "alice", AGE_12_HOURS);

    const candidates = computeArchiveCandidates([plan, pastByOne, newer], NOW, DEFAULT_TTL);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc_id).toBe(pastByOne.id);
    expect(candidates[0]!.rule).toBe("superseded_handoff");
  });

  it("R2 reuses handoffTtlMinutes (D1): raising the injected TTL past the doc's age protects it, no second threshold exists", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const older = handoffDoc(plan.id, "alice", AGE_26_DAYS); // 37440m old
    const newer = handoffDoc(plan.id, "alice", AGE_12_HOURS);
    const docs = [plan, older, newer];

    expect(computeArchiveCandidates(docs, NOW, { handoffTtlMinutes: 10080, claimTtlMinutes: 120 })).toHaveLength(1);
    expect(computeArchiveCandidates(docs, NOW, { handoffTtlMinutes: 40000, claimTtlMinutes: 120 })).toEqual([]);
  });
});

// ─── STATE — per-doc age, not a group-wide age ──────────────────────────────

describe("computeArchiveCandidates R2 recency guard — STATE", () => {
  it("a 3-handoff chain straddling the TTL flags only the old member, never the young one", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const old = handoffDoc(plan.id, "alice", AGE_26_DAYS); // past TTL → candidate
    const young = handoffDoc(plan.id, "alice", AGE_1_DAY); // inside TTL → protected
    const newest = handoffDoc(plan.id, "alice", AGE_12_HOURS); // newest → never a candidate

    const candidates = computeArchiveCandidates([plan, old, young, newest], NOW, DEFAULT_TTL);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.doc_id).toBe(old.id);
    expect(candidates.map((c) => c.doc_id)).not.toContain(young.id);
    expect(candidates.map((c) => c.doc_id)).not.toContain(newest.id);
  });
});

// ─── REGRESSION — D3 attribution precedence ─────────────────────────────────

describe("computeArchiveCandidates R2 recency guard — REGRESSION (D3 precedence)", () => {
  it("a doc satisfying BOTH R2 and R3 is reported exactly once, naming supersession", () => {
    // Parent plan ARCHIVED + past TTL → R3's conditions also hold. R2 must win.
    const plan = makeDoc("plan", {}, { status: "archived" });
    const older = handoffDoc(plan.id, "alice", AGE_26_DAYS);
    const newer = handoffDoc(plan.id, "alice", AGE_TTL_PLUS_1M);

    const candidates = computeArchiveCandidates([plan, older, newer], NOW, DEFAULT_TTL);

    const forOlder = candidates.filter((c) => c.doc_id === older.id);
    expect(forOlder).toHaveLength(1);
    expect(forOlder[0]!.rule).toBe("superseded_handoff");
    expect(forOlder[0]!.reason).toContain("superseded");
    // The newer one is past the TTL under a terminal plan, so R3 legitimately
    // owns it — proving R3 still fires and this is not a blanket suppression.
    const forNewer = candidates.filter((c) => c.doc_id === newer.id);
    expect(forNewer).toHaveLength(1);
    expect(forNewer[0]!.rule).toBe("expired_handoff");
  });

  it("a YOUNG superseded handoff under an archived plan stays out of R3 as well (age is R3's own condition)", () => {
    const plan = makeDoc("plan", {}, { status: "archived" });
    const older = handoffDoc(plan.id, "alice", AGE_1_DAY);
    const newer = handoffDoc(plan.id, "alice", AGE_12_HOURS);

    expect(computeArchiveCandidates([plan, older, newer], NOW, DEFAULT_TTL)).toEqual([]);
  });

  it("the guard does not mutate its docs input", () => {
    const plan = makeDoc("plan", {}, { status: "active" });
    const older = handoffDoc(plan.id, "alice", AGE_1_DAY);
    const newer = handoffDoc(plan.id, "alice", AGE_12_HOURS);
    const docs = [plan, older, newer];
    const snapshot = JSON.parse(JSON.stringify(docs));

    computeArchiveCandidates(docs, NOW, DEFAULT_TTL);

    expect(JSON.parse(JSON.stringify(docs))).toEqual(snapshot);
  });
});
