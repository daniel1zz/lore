/**
 * `detectParentCycleViaAncestry` (store-shared.ts) — pure-logic contract suite.
 *
 * Runner: vitest — no bun:sqlite dependency; the ancestor lookup is injected
 * as a plain async callback, so this exercises the shared walk/depth-cap/
 * self-link logic directly, independent of SQLiteStore/TursoStore's SQL.
 *
 * Context: spec-corpus-schema §4.3 audit finding (2026-07-27) — the OLD
 * per-store `detectParentCycle` walked the `links` table only, which
 * `CorpusService.create`'s `--parent` path never populates (it writes
 * `docs.parent_id` directly). The fix walks `docs.parent_id` — the
 * authoritative tree column — via this shared helper, injected with a
 * `getParentId` callback so SQLiteStore (sync read) and TursoStore (async
 * `@libsql/client` read) share one walk. `sqlite-store.bun.test.ts` and
 * `turso-store.bun.test.ts` cover the SAME regression scenario end-to-end
 * through the real stores (AC-STORE-005.11/.12/.13/.14); this file covers
 * the walk's own boundary/defensive behavior that real store data can never
 * exercise (a pre-existing corrupted `parent_id` chain, and the depth-cap
 * backstop for a chain that never repeats an id).
 *
 * Test design techniques applied:
 *   EP: cycle / no-cycle / self-link
 *   BVA: 1-hop cycle, empty chain, depth-cap boundary
 *   Decision Table: fromId===toId × chain-contains-fromId × chain-has-pre-existing-cycle
 *   State Transition: call-count assertions proving short-circuit / termination
 *
 * @spec_ref spec-corpus-schema §4.3
 */

import { describe, expect, it } from "vitest";
import {
  detectParentCycleViaAncestry,
  PARENT_CYCLE_DEPTH_CAP,
} from "../../../src/store/store-shared.js";

/**
 * Builds a `getParentId` callback backed by a plain `Map<child, parent>` —
 * the pure equivalent of a `docs.parent_id` lookup, with a call counter so
 * tests can assert short-circuiting and termination.
 */
function makeAncestryLookup(chain: Record<string, string | null>): {
  getParentId: (id: string) => Promise<string | null>;
  callCount: () => number;
} {
  let calls = 0;
  return {
    getParentId: async (id: string) => {
      calls += 1;
      return chain[id] ?? null;
    },
    callCount: () => calls,
  };
}

describe("detectParentCycleViaAncestry", () => {
  describe("happy path", () => {
    it("toId has no parent (root doc) — no cycle", async () => {
      const { getParentId } = makeAncestryLookup({});
      const result = await detectParentCycleViaAncestry("child-1", "root-1", getParentId);
      expect(result.ok).toBe(true);
    });

    it("toId's ancestor chain terminates without ever reaching fromId — no cycle", async () => {
      const { getParentId } = makeAncestryLookup({
        "to-1": "grandparent-1",
        "grandparent-1": "great-grandparent-1",
        // great-grandparent-1 has no entry → chain ends (root)
      });
      const result = await detectParentCycleViaAncestry("from-1", "to-1", getParentId);
      expect(result.ok).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("self-link (fromId === toId) is rejected without any ancestry lookup", async () => {
      const { getParentId, callCount } = makeAncestryLookup({ "x-1": "x-1" });
      const result = await detectParentCycleViaAncestry("x-1", "x-1", getParentId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
      if (result.error.code !== "LINK_CYCLE") return;
      expect(result.error.path).toEqual(["x-1"]);
      // Self-link short-circuits before the chain walk starts.
      expect(callCount()).toBe(0);
    });
  });

  describe("boundary values", () => {
    it("REGRESSION (audit 2026-07-27): 1-hop cycle — toId's direct parent_id is fromId (the exact create-time-edge scenario)", async () => {
      // Mirrors `lore create --parent`: child's parent_id is set directly,
      // never through a links-table write. root → child is the pending
      // link under test; child's EXISTING parent_id already points back to
      // root, which is what a links-table-only walk would miss.
      const { getParentId } = makeAncestryLookup({ child: "root" });
      const result = await detectParentCycleViaAncestry("root", "child", getParentId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
      if (result.error.code !== "LINK_CYCLE") return;
      expect(result.error.path).toEqual(["root", "child", "root"]);
    });

    it("deeper chain: fromId appears three hops up toId's parent_id chain — rejected", async () => {
      const { getParentId } = makeAncestryLookup({
        c: "b",
        b: "a",
      });
      // a → c would close a→c→b→a
      const result = await detectParentCycleViaAncestry("a", "c", getParentId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
      if (result.error.code !== "LINK_CYCLE") return;
      expect(result.error.path).toEqual(["a", "c", "b", "a"]);
    });

    it("depth-cap backstop: a chain that never repeats an id and never reaches fromId terminates at PARENT_CYCLE_DEPTH_CAP, not infinitely", async () => {
      // A synthetic ancestor generator producing a fresh id every call —
      // the `seen` set never catches a repeat, so only the depth cap can
      // terminate this walk. Defends against a corrupted/malicious
      // parent_id chain in stored data (the fix's own write-time guard
      // prevents new data from ever looking like this).
      let n = 0;
      let calls = 0;
      const getParentId = async (_id: string) => {
        calls += 1;
        n += 1;
        return `generated-${n}`;
      };
      const result = await detectParentCycleViaAncestry("fromId-never-present", "to-1", getParentId);
      expect(result.ok).toBe(true);
      expect(calls).toBe(PARENT_CYCLE_DEPTH_CAP);
    });
  });

  describe("error handling", () => {
    it("cycle path always starts with fromId and ends with fromId re-appearing", async () => {
      const { getParentId } = makeAncestryLookup({ b: "a" });
      const result = await detectParentCycleViaAncestry("a", "b", getParentId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
      if (result.error.code !== "LINK_CYCLE") return;
      expect(result.error.path[0]).toBe("a");
      expect(result.error.path.at(-1)).toBe("a");
    });
  });

  describe("state transitions", () => {
    it("a pre-existing corrupted parent_id cycle NOT involving fromId is walked without looping forever (seen-set backstop) and reports no cycle", async () => {
      // x → y → x → y → ... is a corrupted chain that never includes
      // fromId. The `seen` set must break this loop; without it the walk
      // would spin until the depth cap (1000 calls) instead of the true
      // early-exit at 2-3 hops.
      const { getParentId, callCount } = makeAncestryLookup({
        "to-1": "x",
        x: "y",
        y: "x",
      });
      const result = await detectParentCycleViaAncestry("fromId-absent", "to-1", getParentId);
      expect(result.ok).toBe(true);
      // seen-set breaks on the second visit to "x" — bounded well under
      // the depth cap, proving the early-exit path (not the cap) fired.
      expect(callCount()).toBeLessThan(10);
    });
  });

  describe("regression", () => {
    it("audit repro: docs.parent_id-only chain (no links-table concept at all in this pure test) still detects the cycle", async () => {
      // The whole point of the fix: this helper takes NO links-table input
      // whatsoever — it is handed only a parent_id lookup, proving the walk
      // cannot regress to depending on link rows.
      const { getParentId } = makeAncestryLookup({ leaf: "mid", mid: "root" });
      const result = await detectParentCycleViaAncestry("root", "leaf", getParentId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("LINK_CYCLE");
    });
  });
});
