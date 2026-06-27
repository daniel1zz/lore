/**
 * @spec_ref TECH-01KV4W88GZF74B98BHCBBV9GHD §4.2
 *
 * RED-phase tests for src/core/graph-utils.ts
 * These tests MUST fail until the implementation module is created.
 *
 * Test design (spec-first, before reading implementation):
 * ancestorChainWalk(startId, getParent):
 *   - Walks parent chain from startId using getParent(id) => string | null
 *   - Uses a Set<string> internally to detect re-visited nodes
 *   - Returns { hasCycle: boolean; path: string[] }
 *   - Self-loop (getParent(x) === x): hasCycle=true, NO infinite loop
 *   - A→B→A cycle: hasCycle=true
 *   - Acyclic linear chain: hasCycle=false, path = full chain from startId to root
 *   - Single node with null parent: hasCycle=false, path = [startId]
 *
 * Dimensions:
 * HAPPY: acyclic chain — path order is correct; single-node (null parent)
 * NEGATIVE: self-loop returns hasCycle=true; A→B→A returns hasCycle=true
 * BOUNDARY: single-node chain; getParent always returns null immediately;
 *           chain of length 2 (child + parent at root)
 * ERROR: N/A — pure synchronous function, getParent callback controls behavior
 * STATE: N/A — stateless pure function
 * REGRESSION: function terminates for self-loop (no infinite loop regression)
 */

import { describe, it, expect } from "vitest";
import { ancestorChainWalk } from "@lore/core";

// ── HAPPY path ───────────────────────────────────────────────────────────────

describe("ancestorChainWalk — happy path (AC-GRAPHUTILS-HAPPY)", () => {
  it("single-node chain with null parent returns hasCycle=false and path=[startId]", () => {
    const result = ancestorChainWalk("A", (_id) => null);
    expect(result.hasCycle).toBe(false);
    expect(result.path).toEqual(["A"]);
  });

  it("linear 2-node chain returns hasCycle=false and path in correct order", () => {
    // A → B (B is root, parent=null)
    const parentMap: Record<string, string | null> = { A: "B", B: null };
    const result = ancestorChainWalk("A", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(false);
    expect(result.path).toEqual(["A", "B"]);
  });

  it("linear 3-node chain returns hasCycle=false and full path", () => {
    // A → B → C (C is root, parent=null)
    const parentMap: Record<string, string | null> = {
      A: "B",
      B: "C",
      C: null,
    };
    const result = ancestorChainWalk("A", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(false);
    expect(result.path).toEqual(["A", "B", "C"]);
  });

  it("walk from a middle node returns only the sub-chain from that node", () => {
    // B → C (C is root)
    const parentMap: Record<string, string | null> = { B: "C", C: null };
    const result = ancestorChainWalk("B", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(false);
    expect(result.path).toEqual(["B", "C"]);
  });

  it("path includes startId as first element", () => {
    const result = ancestorChainWalk("ROOT", (_id) => null);
    expect(result.path[0]).toBe("ROOT");
  });
});

// ── NEGATIVE cases ────────────────────────────────────────────────────────────

describe("ancestorChainWalk — negative cases (AC-GRAPHUTILS-NEG)", () => {
  it("[AC-GRAPHUTILS-NEG-001] self-loop (getParent(x) === x) returns hasCycle=true", () => {
    // spec §4.2: self-loop MUST return hasCycle=true and not infinite-loop
    const result = ancestorChainWalk("A", (_id) => "A");
    expect(result.hasCycle).toBe(true);
  });

  it("[AC-GRAPHUTILS-NEG-002] A→B→A cycle returns hasCycle=true (visited-set defense)", () => {
    const parentMap: Record<string, string | null> = { A: "B", B: "A" };
    const result = ancestorChainWalk("A", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(true);
  });

  it("[AC-GRAPHUTILS-NEG-003] 3-node cycle A→B→C→A returns hasCycle=true", () => {
    const parentMap: Record<string, string | null> = {
      A: "B",
      B: "C",
      C: "A",
    };
    const result = ancestorChainWalk("A", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(true);
  });

  it("[AC-GRAPHUTILS-NEG-004] cycle starting from mid-chain node is detected", () => {
    // Start from B where B→C→B
    const parentMap: Record<string, string | null> = { B: "C", C: "B" };
    const result = ancestorChainWalk("B", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(true);
  });
});

// ── BOUNDARY values ───────────────────────────────────────────────────────────

describe("ancestorChainWalk — boundary values (AC-GRAPHUTILS-BOUNDARY)", () => {
  it("single-node (parent=null immediately) is not a cycle — hasCycle=false", () => {
    const result = ancestorChainWalk("ONLY", (_id) => null);
    expect(result.hasCycle).toBe(false);
  });

  it("path for single-node chain has exactly 1 element", () => {
    const result = ancestorChainWalk("SOLE", (_id) => null);
    expect(result.path).toHaveLength(1);
  });

  it("path for 2-node acyclic chain has exactly 2 elements", () => {
    const result = ancestorChainWalk("CHILD", (id) =>
      id === "CHILD" ? "PARENT" : null,
    );
    expect(result.hasCycle).toBe(false);
    expect(result.path).toHaveLength(2);
  });

  it("[boundary] self-loop path contains the startId (walk records visited node before detecting cycle)", () => {
    // The path must at minimum contain the startId even when a cycle is found
    const result = ancestorChainWalk("X", (_id) => "X");
    expect(result.hasCycle).toBe(true);
    expect(result.path).toContain("X");
  });

  it("[boundary] 5-node linear chain returns complete path of 5 elements", () => {
    const parentMap: Record<string, string | null> = {
      A: "B",
      B: "C",
      C: "D",
      D: "E",
      E: null,
    };
    const result = ancestorChainWalk("A", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(false);
    expect(result.path).toHaveLength(5);
    expect(result.path[0]).toBe("A");
    expect(result.path[4]).toBe("E");
  });
});

// ── STATE / purity ────────────────────────────────────────────────────────────

describe("ancestorChainWalk — state / purity (AC-GRAPHUTILS-STATE)", () => {
  it("calling the function twice with the same inputs returns identical results (pure function)", () => {
    const parentMap: Record<string, string | null> = { A: "B", B: "C", C: null };
    const getParent = (id: string) => parentMap[id] ?? null;
    const first = ancestorChainWalk("A", getParent);
    const second = ancestorChainWalk("A", getParent);
    expect(second.hasCycle).toBe(first.hasCycle);
    expect(second.path).toEqual(first.path);
  });

  it("two independent calls on different chain roots do not interfere with each other", () => {
    const chainX: Record<string, string | null> = { X: "Y", Y: null };
    const chainA: Record<string, string | null> = { A: "B", B: "C", C: null };
    const resultX = ancestorChainWalk("X", (id) => chainX[id] ?? null);
    const resultA = ancestorChainWalk("A", (id) => chainA[id] ?? null);
    expect(resultX.path).toEqual(["X", "Y"]);
    expect(resultA.path).toEqual(["A", "B", "C"]);
  });
});

// ── REGRESSION guards ─────────────────────────────────────────────────────────

describe("ancestorChainWalk — regression guards (AC-GRAPHUTILS-REGRESSION)", () => {
  it("[REGRESSION] self-loop does NOT cause infinite loop — function must return synchronously", () => {
    // If this test hangs, the implementation has an infinite loop regression.
    // Vitest's default timeout (5s) will catch an infinite loop.
    const result = ancestorChainWalk("LOOP", (_id) => "LOOP");
    expect(result.hasCycle).toBe(true);
  });

  it("[REGRESSION] A→B→A cycle does NOT cause infinite loop — function returns synchronously", () => {
    const parentMap: Record<string, string | null> = { A: "B", B: "A" };
    const result = ancestorChainWalk("A", (id) => parentMap[id] ?? null);
    expect(result.hasCycle).toBe(true);
  });

  it("[REGRESSION] result always has both hasCycle and path fields", () => {
    const result = ancestorChainWalk("Z", (_id) => null);
    expect(result).toHaveProperty("hasCycle");
    expect(result).toHaveProperty("path");
  });
});
