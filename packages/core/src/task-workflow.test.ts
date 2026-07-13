/**
 * Tests for @lore/core task-workflow — isClaimStale, evaluateReadiness,
 * evidenceEntrySchema.attestation, resolveTargetTask, isApprovedVerifyCommand.
 * Pure functions, no IO. Spec-first: assertions come from SPEC-025 §3 D2/D3,
 * §4 AC-WF-3/4/7/8, §8.2/§8.3, §7 test guidance, and SPEC-039 §2 D1, D4, §M2 —
 * not from reading the implementation body first.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      readiness of an unblocked task; claim annotation on a fresh claim;
 *               evidenceEntrySchema parses with/without attestation;
 *               resolveTargetTask resolves the sole fresh claim, and resolves an
 *               explicit id/slug override regardless of claim state;
 *               isApprovedVerifyCommand true for a command present in evidence history
 *   NEGATIVE:   non-archived blocker keeps a task unready; ambiguous fresh-claim
 *               set is a fail-loud error listing candidate slugs; an explicit
 *               task ref absent from the plan errors instead of falling back;
 *               isApprovedVerifyCommand false for a task with zero evidence
 *   BOUNDARY:   isClaimStale at exactly TTL, TTL±1min; blocker link with no
 *               matching blockerStatuses entry (defensive fail-loud-by-omission);
 *               attestation.duration_ms at 0/-1, exit_code negative, runner
 *               outside ATTESTATION_RUNNERS; zero fresh claims; a stale claim
 *               excluded from candidacy; empty tasks array; attestation.first_seen
 *               true/false/absent all parse; isApprovedVerifyCommand is an EXACT
 *               string match (a single trailing-space difference is "new")
 *   ERROR:      n/a at this layer (pure functions have no Result channel) —
 *               resolveTargetTask uses Result, covered under NEGATIVE/BOUNDARY
 *   STATE:      cycle A blocks B blocks A — both blocked & visible;
 *               evaluateReadiness's new parentSpecStatus parameter (SPEC-032 §3.4)
 *   REGRESSION: evaluateReadiness never mutates its inputs; input order preserved;
 *               ATTESTATION_RUNNERS is locked to exactly ["lore-cli"]; a MIXED
 *               evidence array (legacy entry without attestation + new entry
 *               with it) parses as a whole and extractEvidence returns both;
 *               resolveTargetTask never mutates its tasks input; a legacy
 *               attestation object with no first_seen field still parses
 *
 * @spec_ref AC-WF-3, AC-WF-4, AC-WF-7, AC-WF-8, SPEC-032 §3.4; SPEC-039 §2 D1, D4;
 *   AC-VRF-1, AC-VRF-7; SPEC-039 §M2
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  isClaimStale,
  evaluateReadiness,
  evidenceEntrySchema,
  extractEvidence,
  ATTESTATION_RUNNERS,
  resolveTargetTask,
  isApprovedVerifyCommand,
  type BlockerInfo,
} from "./task-workflow.js";
import type { DocId, DocRecord, LinkRecord } from "./types.js";

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

function blocksLink(fromId: DocId, toId: DocId): LinkRecord {
  return {
    from_id: fromId,
    to_id: toId,
    link_type: "blocks",
    created_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
  };
}

const NOW = "2026-07-02T10:00:00.000Z";

// ─── isClaimStale — BOUNDARY ─────────────────────────────────────────────────

describe("isClaimStale — TTL boundary (AC-WF-4, D10)", () => {
  it("age exactly equal to ttlMinutes is NOT stale (strict > comparison)", () => {
    // 120 minutes elapsed exactly, ttl=120 → not stale per doc comment
    // ("remains fresh until the instant it crosses the threshold")
    const claim = { by: "alice", at: "2026-07-02T08:00:00.000Z" };
    const now = "2026-07-02T10:00:00.000Z"; // exactly 120 min later
    expect(isClaimStale(claim, now, 120)).toBe(false);
  });

  it("age one minute past ttlMinutes IS stale", () => {
    const claim = { by: "alice", at: "2026-07-02T08:00:00.000Z" };
    const now = "2026-07-02T10:01:00.000Z"; // 121 min later
    expect(isClaimStale(claim, now, 120)).toBe(true);
  });

  it("age one minute short of ttlMinutes is NOT stale", () => {
    const claim = { by: "alice", at: "2026-07-02T08:00:00.000Z" };
    const now = "2026-07-02T09:59:00.000Z"; // 119 min later
    expect(isClaimStale(claim, now, 120)).toBe(false);
  });

  it("respects a non-default TTL value (defeats a hardcoded 120 check)", () => {
    const claim = { by: "alice", at: "2026-07-02T09:00:00.000Z" };
    const now = "2026-07-02T09:31:00.000Z"; // 31 min later
    expect(isClaimStale(claim, now, 30)).toBe(true);
    expect(isClaimStale(claim, now, 31)).toBe(false);
  });

  it("zero age (just claimed) is never stale, regardless of TTL", () => {
    const claim = { by: "alice", at: NOW };
    expect(isClaimStale(claim, NOW, 1)).toBe(false);
  });
});

// ─── evaluateReadiness — HAPPY ────────────────────────────────────────────────

describe("evaluateReadiness — HAPPY (AC-WF-7)", () => {
  it("a task with no blockers and non-terminal status is ready", () => {
    const task = makeTask({ status: "draft" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records).toHaveLength(1);
    expect(records[0]?.ready).toBe(true);
    expect(records[0]?.unmet_blockers).toEqual([]);
  });

  it("a task whose sole blocker is archived is ready", () => {
    const blocker = makeTask({ status: "archived" });
    const task = makeTask({ status: "draft" });
    const links = [blocksLink(blocker.id, task.id)];
    const statuses = new Map<DocId, BlockerInfo>([
      [blocker.id, { slug: blocker.slug, status: "archived" }],
    ]);
    const records = evaluateReadiness([task], links, statuses, NOW, 120);
    expect(records[0]?.ready).toBe(true);
    expect(records[0]?.unmet_blockers).toEqual([]);
  });

  it("empty plan (no tasks) returns an empty array, not an error shape", () => {
    const records = evaluateReadiness([], [], new Map(), NOW, 120);
    expect(records).toEqual([]);
  });
});

// ─── evaluateReadiness — NEGATIVE ─────────────────────────────────────────────

describe("evaluateReadiness — NEGATIVE (non-archived blocker)", () => {
  it("a task whose blocker is not archived is NOT ready, and the blocker is listed", () => {
    const blocker = makeTask({ status: "in-review", title: "Blocker Task" });
    const task = makeTask({ status: "draft" });
    const links = [blocksLink(blocker.id, task.id)];
    const statuses = new Map<DocId, BlockerInfo>([
      [blocker.id, { slug: blocker.slug, status: "in-review" }],
    ]);
    const records = evaluateReadiness([task], links, statuses, NOW, 120);
    expect(records[0]?.ready).toBe(false);
    expect(records[0]?.unmet_blockers).toHaveLength(1);
    expect(records[0]?.unmet_blockers[0]).toEqual({
      id: blocker.id,
      slug: blocker.slug,
      status: "in-review",
    });
  });

  it("archived task status is never ready even with zero blockers (terminal status)", () => {
    const task = makeTask({ status: "archived" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.ready).toBe(false);
  });

  it("deprecated task status is never ready even with zero blockers (terminal status)", () => {
    const task = makeTask({ status: "deprecated" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.ready).toBe(false);
  });
});

// ─── evaluateReadiness — BOUNDARY ─────────────────────────────────────────────

describe("evaluateReadiness — BOUNDARY (blocker missing from status map)", () => {
  it("a blocks-link whose from_id has no entry in blockerStatuses is conservatively unmet", () => {
    const task = makeTask({ status: "draft" });
    const ghostBlockerId: DocId = "01HGHOSTAAAAAAAAAAAAAAAAAA";
    const links = [blocksLink(ghostBlockerId, task.id)];
    // blockerStatuses intentionally does not contain ghostBlockerId
    const records = evaluateReadiness([task], links, new Map(), NOW, 120);
    expect(records[0]?.ready).toBe(false);
    expect(records[0]?.unmet_blockers).toHaveLength(1);
    expect(records[0]?.unmet_blockers[0]?.id).toBe(ghostBlockerId);
    // conservative default status per source comment — must not silently pass as "archived"
    expect(records[0]?.unmet_blockers[0]?.status).not.toBe("archived");
  });
});

// ─── evaluateReadiness — STATE (cycles) ───────────────────────────────────────

describe("evaluateReadiness — STATE (A blocks B blocks A cycle, AC-WF-7 + §5 risk table)", () => {
  it("both tasks in a mutual-block cycle are reported blocked and visible, not silently dropped", () => {
    const taskA = makeTask({ status: "draft", title: "Task A" });
    const taskB = makeTask({ status: "draft", title: "Task B" });
    const links = [blocksLink(taskA.id, taskB.id), blocksLink(taskB.id, taskA.id)];
    const statuses = new Map<DocId, BlockerInfo>([
      [taskA.id, { slug: taskA.slug, status: "draft" }],
      [taskB.id, { slug: taskB.slug, status: "draft" }],
    ]);
    const records = evaluateReadiness([taskA, taskB], links, statuses, NOW, 120);
    expect(records).toHaveLength(2);

    const recordA = records.find((r) => r.task.id === taskA.id);
    const recordB = records.find((r) => r.task.id === taskB.id);
    expect(recordA?.ready).toBe(false);
    expect(recordB?.ready).toBe(false);
    expect(recordA?.unmet_blockers.map((b) => b.id)).toEqual([taskB.id]);
    expect(recordB?.unmet_blockers.map((b) => b.id)).toEqual([taskA.id]);
  });
});

// ─── evaluateReadiness — claim annotations ────────────────────────────────────

describe("evaluateReadiness — claim annotations (AC-WF-8)", () => {
  it("a fresh claim is annotated with stale=false and a computed age_minutes", () => {
    const task = makeTask({
      extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA", claim: { by: "bob", at: "2026-07-02T09:30:00.000Z" } },
    });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.claim).toBeDefined();
    expect(records[0]?.claim?.by).toBe("bob");
    expect(records[0]?.claim?.stale).toBe(false);
    expect(records[0]?.claim?.age_minutes).toBe(30);
  });

  it("a stale claim (age > ttl) is annotated with stale=true", () => {
    const task = makeTask({
      extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA", claim: { by: "bob", at: "2026-07-02T07:00:00.000Z" } },
    });
    // 180 min elapsed, ttl=120
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.claim?.stale).toBe(true);
    expect(records[0]?.claim?.age_minutes).toBe(180);
  });

  it("a task with no claim has claim=undefined (not a fabricated default object)", () => {
    const task = makeTask({ extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA" } });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.claim).toBeUndefined();
  });
});

// ─── evaluateReadiness — evidence_count / latest_evidence ────────────────────

describe("evaluateReadiness — evidence_count and latest_evidence", () => {
  it("evidence_count is 0 and latest_evidence undefined when no evidence exists", () => {
    const task = makeTask();
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.evidence_count).toBe(0);
    expect(records[0]?.latest_evidence).toBeUndefined();
  });

  it("evidence_count reflects array length and latest_evidence is the LAST entry, not the first", () => {
    const task = makeTask({
      extra: {
        plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA",
        verification_evidence: [
          { oracle: "tsc", command: "bun run typecheck", result: "fail", recorded_at: "2026-07-01T01:00:00.000Z", recorded_by: "alice" },
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "2026-07-01T02:00:00.000Z", recorded_by: "alice" },
        ],
      },
    });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.evidence_count).toBe(2);
    // Must be the SECOND (last) entry's result — a hardcoded-first-entry bug would report "fail"
    expect(records[0]?.latest_evidence).toEqual({ result: "pass", recorded_at: "2026-07-01T02:00:00.000Z" });
  });
});

// ─── evaluateReadiness — parentSpecStatus advisory (SPEC-032 §3.4, AC-6) ──────

describe("evaluateReadiness — parentSpecStatus advisory (SPEC-032 §3.4)", () => {
  it("parentSpecStatus omitted (pre-existing 5-arg call sites) → upstream_unapproved absent", () => {
    const task = makeTask({ status: "draft" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(records[0]?.upstream_unapproved).toBeUndefined();
  });

  it("parentSpecStatus null (plan has no spec parent — top-level or prd-parented) → absent, not an error", () => {
    const task = makeTask({ status: "draft" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120, null);
    expect(records[0]?.upstream_unapproved).toBeUndefined();
  });

  it("parentSpecStatus 'approved' → upstream_unapproved absent (not false)", () => {
    const task = makeTask({ status: "draft" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120, "approved");
    expect(records[0]?.upstream_unapproved).toBeUndefined();
  });

  it("parentSpecStatus 'draft' (unapproved) → every record carries upstream_unapproved: true", () => {
    const taskA = makeTask({ status: "draft", title: "A" });
    const taskB = makeTask({ status: "draft", title: "B" });
    const records = evaluateReadiness([taskA, taskB], [], new Map(), NOW, 120, "draft");
    expect(records[0]?.upstream_unapproved).toBe(true);
    expect(records[1]?.upstream_unapproved).toBe(true);
  });

  it("parentSpecStatus 'in-review' (unapproved) → upstream_unapproved: true", () => {
    const task = makeTask({ status: "draft" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120, "in-review");
    expect(records[0]?.upstream_unapproved).toBe(true);
  });

  it("unapproved parent spec NEVER flips readiness — an unblocked task stays ready", () => {
    const task = makeTask({ status: "draft" });
    const records = evaluateReadiness([task], [], new Map(), NOW, 120, "draft");
    expect(records[0]?.ready).toBe(true);
    expect(records[0]?.upstream_unapproved).toBe(true);
  });

  it("unapproved parent spec does not manufacture readiness for a blocked task either", () => {
    const blocker = makeTask({ status: "in-review", title: "Blocker" });
    const task = makeTask({ status: "draft" });
    const links = [blocksLink(blocker.id, task.id)];
    const statuses = new Map<DocId, BlockerInfo>([
      [blocker.id, { slug: blocker.slug, status: "in-review" }],
    ]);
    const records = evaluateReadiness([task], links, statuses, NOW, 120, "draft");
    expect(records[0]?.ready).toBe(false);
    expect(records[0]?.upstream_unapproved).toBe(true);
  });
});

// ─── evaluateReadiness — REGRESSION (purity, order) ───────────────────────────

describe("evaluateReadiness — REGRESSION (purity + ordering)", () => {
  it("does not mutate the input tasks array or its elements", () => {
    const task = makeTask({ status: "draft" });
    const snapshot = JSON.parse(JSON.stringify(task));
    evaluateReadiness([task], [], new Map(), NOW, 120);
    expect(task).toEqual(snapshot);
  });

  it("returns one record per input task, in input order", () => {
    const taskA = makeTask({ title: "First" });
    const taskB = makeTask({ title: "Second" });
    const taskC = makeTask({ title: "Third" });
    const records = evaluateReadiness([taskA, taskB, taskC], [], new Map(), NOW, 120);
    expect(records.map((r) => r.task.id)).toEqual([taskA.id, taskB.id, taskC.id]);
  });

  it("phase is carried through only when task.extra.phase is a string", () => {
    const withPhase = makeTask({ extra: { plan_id: "x", phase: "Foundation" } });
    const withoutPhase = makeTask({ extra: { plan_id: "x" } });
    const records = evaluateReadiness([withPhase, withoutPhase], [], new Map(), NOW, 120);
    expect(records[0]?.phase).toBe("Foundation");
    expect(records[1]?.phase).toBeUndefined();
  });
});

// ─── evidenceEntrySchema.attestation (SPEC-039 §2 D1, AC-VRF-1) ───────────────

describe("evidenceEntrySchema.attestation", () => {
  it("HAPPY: parses an entry WITH a full valid attestation object", () => {
    const result = evidenceEntrySchema.safeParse({
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_at: "2026-07-08T10:00:00.000Z",
      recorded_by: "lore-cli",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1234, timed_out: false },
    });
    expect(result.success).toBe(true);
  });

  it("HAPPY: parses an entry WITHOUT attestation (legacy shape, field stays optional)", () => {
    const result = evidenceEntrySchema.safeParse({
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_at: "2026-07-08T10:00:00.000Z",
      recorded_by: "alice",
    });
    expect(result.success).toBe(true);
  });

  it("REGRESSION: a MIXED array (one legacy entry without attestation, one new entry with it) " +
    "parses as a WHOLE via z.array(evidenceEntrySchema).safeParse — the optional field must not " +
    "fail-close the entire array (SPEC-039 §9)", () => {
    const mixedArray = [
      {
        oracle: "tsc", command: "bun run typecheck", result: "pass",
        recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "alice",
      },
      {
        oracle: "test", command: "bun test", result: "pass",
        recorded_at: "2026-07-08T10:00:00.000Z", recorded_by: "lore-cli",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 500, timed_out: false },
      },
    ];

    const parsed = z.array(evidenceEntrySchema).safeParse(mixedArray);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveLength(2);
    }

    const task = makeTask({
      extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA", verification_evidence: mixedArray },
    });
    const extracted = extractEvidence(task);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]?.attestation).toBeUndefined();
    expect(extracted[1]?.attestation).toBeDefined();
    expect(extracted[1]?.attestation?.runner).toBe("lore-cli");
  });
});

// ─── evidenceEntrySchema.attestation — BOUNDARY ───────────────────────────────

describe("evidenceEntrySchema.attestation — BOUNDARY on the attestation object", () => {
  function baseEntry(attestation: Record<string, unknown>) {
    return {
      oracle: "test",
      command: "bun test",
      result: "pass",
      recorded_at: "2026-07-08T10:00:00.000Z",
      recorded_by: "lore-cli",
      attestation,
    };
  }

  it("BOUNDARY: duration_ms of -1 is rejected (min(0))", () => {
    const result = evidenceEntrySchema.safeParse(
      baseEntry({ runner: "lore-cli", exit_code: 0, duration_ms: -1, timed_out: false }),
    );
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: duration_ms of 0 is accepted", () => {
    const result = evidenceEntrySchema.safeParse(
      baseEntry({ runner: "lore-cli", exit_code: 0, duration_ms: 0, timed_out: false }),
    );
    expect(result.success).toBe(true);
  });

  it("BOUNDARY: exit_code accepts negative integers (killed process signal encoding) — no min bound", () => {
    const result = evidenceEntrySchema.safeParse(
      baseEntry({ runner: "lore-cli", exit_code: -1, duration_ms: 100, timed_out: true }),
    );
    expect(result.success).toBe(true);
  });

  it("BOUNDARY: runner outside ATTESTATION_RUNNERS is rejected", () => {
    const result = evidenceEntrySchema.safeParse(
      baseEntry({ runner: "some-other-runner", exit_code: 0, duration_ms: 100, timed_out: false }),
    );
    expect(result.success).toBe(false);
  });
});

// ─── ATTESTATION_RUNNERS — REGRESSION ─────────────────────────────────────────

describe("ATTESTATION_RUNNERS — REGRESSION (locked enum)", () => {
  it("is exactly ['lore-cli'] — adding/removing a runner without reviewing this test must fail loud", () => {
    expect(ATTESTATION_RUNNERS).toEqual(["lore-cli"]);
    expect(ATTESTATION_RUNNERS.length).toBe(1);
  });
});

// ─── resolveTargetTask (SPEC-039 §2 D4, AC-VRF-7) ─────────────────────────────

describe("resolveTargetTask — HAPPY (sole fresh claim)", () => {
  it("resolves to the one task with a fresh claim among several with none", () => {
    const claimed = makeTask({
      title: "Claimed",
      extra: { plan_id: "p", claim: { by: "alice", at: NOW } },
    });
    const unclaimedA = makeTask({ title: "UnclaimedA" });
    const unclaimedB = makeTask({ title: "UnclaimedB" });

    const result = resolveTargetTask([unclaimedA, claimed, unclaimedB], {
      nowIso: NOW,
      ttlMinutes: 120,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(claimed.id);
    }
  });
});

describe("resolveTargetTask — NEGATIVE/BOUNDARY (zero fresh claims)", () => {
  it("zero tasks with a fresh claim → err with field 'task', message mentions --task", () => {
    const a = makeTask({ title: "A" });
    const b = makeTask({ title: "B" });

    const result = resolveTargetTask([a, b], { nowIso: NOW, ttlMinutes: 120 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("task");
        expect(result.error.message).toContain("--task");
      }
    }
  });

  it("empty tasks array with no explicit id → err (zero candidates), does not throw", () => {
    expect(() => resolveTargetTask([], { nowIso: NOW, ttlMinutes: 120 })).not.toThrow();
    const result = resolveTargetTask([], { nowIso: NOW, ttlMinutes: 120 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("resolveTargetTask — NEGATIVE (ambiguous fresh claims)", () => {
  it("two-plus tasks with fresh claims → err, message contains both slugs, value is candidate slug array", () => {
    const claimedA = makeTask({
      title: "ClaimedA",
      extra: { plan_id: "p", claim: { by: "alice", at: NOW } },
    });
    const claimedB = makeTask({
      title: "ClaimedB",
      extra: { plan_id: "p", claim: { by: "bob", at: NOW } },
    });

    const result = resolveTargetTask([claimedA, claimedB], { nowIso: NOW, ttlMinutes: 120 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.message).toContain(claimedA.slug);
        expect(result.error.message).toContain(claimedB.slug);
        expect(result.error.value).toEqual([claimedA.slug, claimedB.slug]);
      }
    }
  });
});

describe("resolveTargetTask — BOUNDARY (stale claim excluded from candidacy)", () => {
  it("a stale claim is excluded — one fresh + one stale claim resolves to the fresh one, not an ambiguity error", () => {
    const fresh = makeTask({
      title: "Fresh",
      extra: { plan_id: "p", claim: { by: "alice", at: NOW } },
    });
    const stale = makeTask({
      title: "Stale",
      // 200 minutes before NOW, ttl=120 → stale
      extra: { plan_id: "p", claim: { by: "bob", at: "2026-07-02T06:40:00.000Z" } },
    });

    const result = resolveTargetTask([fresh, stale], { nowIso: NOW, ttlMinutes: 120 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(fresh.id);
    }
  });
});

describe("resolveTargetTask — HAPPY (explicit override wins)", () => {
  it("matches by .id — wins even when claim-based resolution would be ambiguous", () => {
    const claimedA = makeTask({
      title: "ClaimedA",
      extra: { plan_id: "p", claim: { by: "alice", at: NOW } },
    });
    const claimedB = makeTask({
      title: "ClaimedB",
      extra: { plan_id: "p", claim: { by: "bob", at: NOW } },
    });

    const result = resolveTargetTask([claimedA, claimedB], {
      explicitTaskIdOrSlug: claimedB.id,
      nowIso: NOW,
      ttlMinutes: 120,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(claimedB.id);
    }
  });

  it("matches by .slug — wins even when claim-based resolution would be empty", () => {
    const a = makeTask({ title: "A" });
    const b = makeTask({ title: "B" });

    const result = resolveTargetTask([a, b], {
      explicitTaskIdOrSlug: b.slug,
      nowIso: NOW,
      ttlMinutes: 120,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe(b.id);
    }
  });
});

describe("resolveTargetTask — NEGATIVE (explicit ref not found)", () => {
  it("an explicit task ref naming something NOT in tasks → err(VALIDATION_ERROR), no fallback to claim resolution", () => {
    const claimed = makeTask({
      title: "Claimed",
      extra: { plan_id: "p", claim: { by: "alice", at: NOW } },
    });

    const result = resolveTargetTask([claimed], {
      explicitTaskIdOrSlug: "does-not-exist-anywhere",
      nowIso: NOW,
      ttlMinutes: 120,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("task");
        expect(result.error.value).toBe("does-not-exist-anywhere");
      }
    }
  });
});

describe("resolveTargetTask — REGRESSION (purity)", () => {
  it("does not mutate its tasks input", () => {
    const a = makeTask({
      title: "A",
      extra: { plan_id: "p", claim: { by: "alice", at: NOW } },
    });
    const b = makeTask({ title: "B" });
    const snapshotA = JSON.parse(JSON.stringify(a));
    const snapshotB = JSON.parse(JSON.stringify(b));

    resolveTargetTask([a, b], { nowIso: NOW, ttlMinutes: 120 });

    expect(a).toEqual(snapshotA);
    expect(b).toEqual(snapshotB);
  });
});

// ─── isApprovedVerifyCommand (SPEC-039 §M2 command-provenance approval) ───────

function evidenceEntry(command: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    oracle: "test" as const,
    command,
    result: "pass" as const,
    recorded_at: NOW,
    recorded_by: "alice",
    ...overrides,
  };
}

describe("isApprovedVerifyCommand — HAPPY", () => {
  it("true when a prior evidence entry recorded this EXACT command string", () => {
    const task = makeTask({
      extra: { plan_id: "p", verification_evidence: [evidenceEntry("bun test")] },
    });
    expect(isApprovedVerifyCommand(task, "bun test")).toBe(true);
  });

  it("true when the match is one of several prior entries, order-independent", () => {
    const task = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          evidenceEntry("bun run typecheck"),
          evidenceEntry("bun test"),
          evidenceEntry("bun run lint"),
        ],
      },
    });
    expect(isApprovedVerifyCommand(task, "bun test")).toBe(true);
  });
});

describe("isApprovedVerifyCommand — NEGATIVE", () => {
  it("false when the task has zero evidence entries", () => {
    const task = makeTask({ extra: { plan_id: "p" } });
    expect(isApprovedVerifyCommand(task, "bun test")).toBe(false);
  });

  it("false when evidence exists but never recorded this command", () => {
    const task = makeTask({
      extra: { plan_id: "p", verification_evidence: [evidenceEntry("bun run typecheck")] },
    });
    expect(isApprovedVerifyCommand(task, "bun test")).toBe(false);
  });
});

describe("isApprovedVerifyCommand — BOUNDARY (exact-match only, no fuzzy normalization)", () => {
  it("a single trailing-space difference is treated as a NEW command", () => {
    const task = makeTask({
      extra: { plan_id: "p", verification_evidence: [evidenceEntry("bun test ")] },
    });
    expect(isApprovedVerifyCommand(task, "bun test")).toBe(false);
  });

  it("a changed flag on an otherwise-identical command is treated as NEW", () => {
    const task = makeTask({
      extra: { plan_id: "p", verification_evidence: [evidenceEntry("bun test --timeout 1000")] },
    });
    expect(isApprovedVerifyCommand(task, "bun test --timeout 2000")).toBe(false);
  });

  it("malformed verification_evidence (not an array) degrades to false, never throws", () => {
    const task = makeTask({ extra: { plan_id: "p", verification_evidence: "not-an-array" } });
    expect(() => isApprovedVerifyCommand(task, "bun test")).not.toThrow();
    expect(isApprovedVerifyCommand(task, "bun test")).toBe(false);
  });
});

// ─── evidenceEntrySchema.attestation.first_seen (SPEC-039 §M2 annotation) ─────

describe("evidenceEntrySchema.attestation.first_seen — BOUNDARY", () => {
  it("parses with first_seen: true", () => {
    const parsed = evidenceEntrySchema.safeParse(
      evidenceEntry("bun test", {
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, first_seen: true },
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.attestation?.first_seen).toBe(true);
  });

  it("parses with first_seen absent (previously-seen command) — field is undefined, not false", () => {
    const parsed = evidenceEntrySchema.safeParse(
      evidenceEntry("bun test", {
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.attestation?.first_seen).toBeUndefined();
  });
});

describe("evidenceEntrySchema.attestation.first_seen — REGRESSION", () => {
  it("a legacy attestation object (pre-M2, no first_seen field) still parses", () => {
    const parsed = evidenceEntrySchema.safeParse(
      evidenceEntry("bun test", {
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1234, timed_out: false },
      }),
    );
    expect(parsed.success).toBe(true);
  });
});
