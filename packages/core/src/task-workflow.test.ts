/**
 * Tests for @lore/core task-workflow — isClaimStale, evaluateReadiness.
 * Pure functions, no IO. Spec-first: assertions come from SPEC-025 §3 D2/D3,
 * §4 AC-WF-3/4/7/8, §8.2/§8.3, and §7 test guidance — not from reading the
 * implementation body first.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      readiness of an unblocked task; claim annotation on a fresh claim
 *   NEGATIVE:   non-archived blocker keeps a task unready
 *   BOUNDARY:   isClaimStale at exactly TTL, TTL±1min; blocker link with no
 *               matching blockerStatuses entry (defensive fail-loud-by-omission)
 *   ERROR:      n/a at this layer (pure functions have no Result channel)
 *   STATE:      cycle A blocks B blocks A — both blocked & visible;
 *               evaluateReadiness's new parentSpecStatus parameter (SPEC-032 §3.4)
 *   REGRESSION: evaluateReadiness never mutates its inputs; input order preserved
 *
 * @spec_ref AC-WF-3, AC-WF-4, AC-WF-7, AC-WF-8, SPEC-032 §3.4
 */

import { describe, it, expect } from "vitest";
import { isClaimStale, evaluateReadiness, type BlockerInfo } from "./task-workflow.js";
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
