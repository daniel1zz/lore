/**
 * Tests for SQLiteStore.findLinksByToIds — batch link query (SPEC-025 §3 D7).
 * `WHERE to_id IN (...) AND link_type = ?` in one round trip, used by
 * TaskWorkflowService.ready() to avoid an N+1 loop over findLinks when
 * computing readiness across a whole plan.
 *
 * Runner: bun:sqlite — must run under `bun test`, not vitest (see
 * store/CLAUDE.md "bun:sqlite is external to vitest").
 *
 * Coverage:
 *   BOUNDARY: empty toIds → ok([]) immediately, no query issued
 *   HAPPY:    multiple ids → returns links targeting any of them
 *   NEGATIVE: type filter excludes links of a different link_type
 *   NEGATIVE: unmatched ids simply contribute no rows (not an error)
 *   REGRESSION: soft-deleted / unrelated links never leak into unrelated toIds queries
 *
 * @spec_ref SPEC-025 §3 D7, §4 AC-WF-7
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { DocRecord, LinkRecord } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Factories ───────────────────────────────────────────────────────────────

let _counter = 0;

function nextId(): string {
  _counter += 1;
  const padded = String(_counter).padStart(20, "0");
  return `01HLINK${padded}`;
}

function makeTask(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  const id = nextId();
  return {
    id,
    slug: `task-fixture-${_counter}`,
    type: "task",
    role: "plan",
    title: `Task ${_counter}`,
    status: "draft",
    priority: "medium",
    content: "Task body",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

function makeLink(fromId: string, toId: string, linkType: LinkRecord["link_type"] = "blocks"): LinkRecord {
  return {
    from_id: fromId,
    to_id: toId,
    link_type: linkType,
    created_at: "2026-07-01T00:00:00.000Z",
    created_by: "agent:test",
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("SQLiteStore.findLinksByToIds", () => {
  let store: SQLiteStore;

  beforeEach(() => {
    store = actedStore(new SQLiteStore(":memory:"));
  });

  afterEach(() => {
    store.close();
  });

  // ── BOUNDARY ─────────────────────────────────────────────────────────────

  describe("BOUNDARY — empty ids array", () => {
    it("returns ok([]) immediately without issuing a query, even with links present in the DB", async () => {
      const a = makeTask();
      const b = makeTask();
      await store.insert(a);
      await store.insert(b);
      await store.addLink(makeLink(a.id, b.id, "blocks"));

      const result = await store.findLinksByToIds([], "blocks");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });
  });

  // ── HAPPY ────────────────────────────────────────────────────────────────

  describe("HAPPY — multiple ids", () => {
    it("returns links whose to_id matches ANY of the given ids", async () => {
      const blocker = makeTask({ title: "Blocker" });
      const blockedA = makeTask({ title: "Blocked A" });
      const blockedB = makeTask({ title: "Blocked B" });
      const unrelated = makeTask({ title: "Unrelated" });
      await store.insert(blocker);
      await store.insert(blockedA);
      await store.insert(blockedB);
      await store.insert(unrelated);

      await store.addLink(makeLink(blocker.id, blockedA.id, "blocks"));
      await store.addLink(makeLink(blocker.id, blockedB.id, "blocks"));
      await store.addLink(makeLink(blocker.id, unrelated.id, "blocks"));

      const result = await store.findLinksByToIds([blockedA.id, blockedB.id], "blocks");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
      const toIds = result.value.map((l) => l.to_id).sort();
      expect(toIds).toEqual([blockedA.id, blockedB.id].sort());
      // The unrelated task's link must NOT leak in — defeats a "return all links" bug.
      expect(result.value.some((l) => l.to_id === unrelated.id)).toBe(false);
    });

    it("a single id returns only links targeting that id", async () => {
      const blocker = makeTask();
      const blocked = makeTask();
      const other = makeTask();
      await store.insert(blocker);
      await store.insert(blocked);
      await store.insert(other);
      await store.addLink(makeLink(blocker.id, blocked.id, "blocks"));
      await store.addLink(makeLink(blocker.id, other.id, "blocks"));

      const result = await store.findLinksByToIds([blocked.id], "blocks");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.to_id).toBe(blocked.id);
    });
  });

  // ── NEGATIVE ─────────────────────────────────────────────────────────────

  describe("NEGATIVE — link_type filter", () => {
    it("excludes links of a different link_type even when to_id matches", async () => {
      const a = makeTask();
      const b = makeTask();
      await store.insert(a);
      await store.insert(b);
      await store.addLink(makeLink(a.id, b.id, "relates-to"));

      const result = await store.findLinksByToIds([b.id], "blocks");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("mixed link types on the same pair: only the requested type is returned", async () => {
      const a = makeTask();
      const b = makeTask();
      await store.insert(a);
      await store.insert(b);
      await store.addLink(makeLink(a.id, b.id, "blocks"));
      await store.addLink(makeLink(a.id, b.id, "relates-to"));

      const blocksResult = await store.findLinksByToIds([b.id], "blocks");
      expect(blocksResult.ok).toBe(true);
      if (!blocksResult.ok) return;
      expect(blocksResult.value).toHaveLength(1);
      expect(blocksResult.value[0]?.link_type).toBe("blocks");

      const relatesResult = await store.findLinksByToIds([b.id], "relates-to");
      expect(relatesResult.ok).toBe(true);
      if (!relatesResult.ok) return;
      expect(relatesResult.value).toHaveLength(1);
      expect(relatesResult.value[0]?.link_type).toBe("relates-to");
    });
  });

  describe("NEGATIVE — ids with no matching links", () => {
    it("an id with no incoming links of that type contributes zero rows, not an error", async () => {
      const lonely = makeTask();
      await store.insert(lonely);

      const result = await store.findLinksByToIds([lonely.id], "blocks");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it("a mix of matching and non-matching ids returns only the matching rows", async () => {
      const blocker = makeTask();
      const blocked = makeTask();
      const lonely = makeTask();
      await store.insert(blocker);
      await store.insert(blocked);
      await store.insert(lonely);
      await store.addLink(makeLink(blocker.id, blocked.id, "blocks"));

      const result = await store.findLinksByToIds([blocked.id, lonely.id], "blocks");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.to_id).toBe(blocked.id);
    });
  });
});
