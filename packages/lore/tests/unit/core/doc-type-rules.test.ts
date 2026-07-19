/**
 * @spec_ref TECH-01KV4W88GZF74B98BHCBBV9GHD §3
 *
 * RED-phase tests for src/core/doc-type-rules.ts
 * These tests MUST fail until the implementation module is created.
 *
 * Test design (spec-first, before reading implementation):
 * PARENT_TYPE_CONTRACT spec:
 *   prd       → [] (root type, no valid parents)
 *   spec      → ["prd"]
 *   adr       → ["prd", "spec"]
 *   plan      → ["prd", "spec"]
 *   task      → ["plan"]
 *   knowledge → ["prd", "spec", "adr", "plan", "knowledge"]
 *
 * isValidParentType(child, parent): boolean
 *   returns true iff parent ∈ PARENT_TYPE_CONTRACT[child]
 *
 * ROOT_TYPES: readonly DocType[]
 *   types whose parent set is empty → ["prd"] only
 *
 * Dimensions:
 * HAPPY: valid parent relationships (spec→prd, task→plan, knowledge→knowledge)
 * NEGATIVE: invalid parent relationships (spec→task, prd→any, task→prd, adr→task)
 * BOUNDARY: knowledge self-nesting; adr→spec (within allowed set)
 * ERROR: N/A — pure synchronous function, no external dependencies
 * STATE: N/A — stateless pure constants and function
 * REGRESSION: ROOT_TYPES must be exactly ["prd"] per spec §3
 */

import { describe, it, expect } from "vitest";
import {
  PARENT_TYPE_CONTRACT,
  isValidParentType,
  ROOT_TYPES,
} from "@lore/core";

// ── HAPPY path ───────────────────────────────────────────────────────────────

describe("isValidParentType — happy path (AC-DOCTYPE-HAPPY)", () => {
  it("spec → prd is a valid parent relationship", () => {
    expect(isValidParentType("spec", "prd")).toBe(true);
  });

  it("task → plan is a valid parent relationship", () => {
    expect(isValidParentType("task", "plan")).toBe(true);
  });

  it("knowledge → knowledge is valid (self-nesting allowed per spec §3)", () => {
    expect(isValidParentType("knowledge", "knowledge")).toBe(true);
  });

  it("adr → prd is a valid parent relationship", () => {
    expect(isValidParentType("adr", "prd")).toBe(true);
  });

  it("adr → spec is a valid parent relationship", () => {
    expect(isValidParentType("adr", "spec")).toBe(true);
  });

  it("plan → prd is a valid parent relationship", () => {
    expect(isValidParentType("plan", "prd")).toBe(true);
  });

  it("plan → spec is a valid parent relationship", () => {
    expect(isValidParentType("plan", "spec")).toBe(true);
  });

  it("knowledge → prd is a valid parent relationship", () => {
    expect(isValidParentType("knowledge", "prd")).toBe(true);
  });

  it("knowledge → plan is a valid parent relationship", () => {
    expect(isValidParentType("knowledge", "plan")).toBe(true);
  });
});

// ── NEGATIVE cases ───────────────────────────────────────────────────────────

describe("isValidParentType — negative cases (AC-DOCTYPE-NEG)", () => {
  it("[AC-DOCTYPE-NEG-001] spec → task is NOT a valid parent (task not in spec's allowed set)", () => {
    expect(isValidParentType("spec", "task")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-002] prd → prd is NOT valid (prd has empty parent set)", () => {
    expect(isValidParentType("prd", "prd")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-003] prd → spec is NOT valid (prd has empty parent set — no valid parents)", () => {
    expect(isValidParentType("prd", "spec")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-004] prd → adr is NOT valid (prd has empty parent set)", () => {
    expect(isValidParentType("prd", "adr")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-005] prd → plan is NOT valid (prd has empty parent set)", () => {
    expect(isValidParentType("prd", "plan")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-006] prd → knowledge is NOT valid (prd has empty parent set)", () => {
    expect(isValidParentType("prd", "knowledge")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-007] prd → task is NOT valid (prd has empty parent set)", () => {
    expect(isValidParentType("prd", "task")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-008] task → prd is NOT valid (task only allows plan as parent)", () => {
    expect(isValidParentType("task", "prd")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-009] adr → task is NOT valid (task not in adr's allowed set)", () => {
    expect(isValidParentType("adr", "task")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-010] task → spec is NOT valid (task only allows plan)", () => {
    expect(isValidParentType("task", "spec")).toBe(false);
  });

  it("[AC-DOCTYPE-NEG-011] task → knowledge is NOT valid (task only allows plan)", () => {
    expect(isValidParentType("task", "knowledge")).toBe(false);
  });
});

// ── BOUNDARY values ──────────────────────────────────────────────────────────

describe("PARENT_TYPE_CONTRACT — boundary values (AC-DOCTYPE-BOUNDARY)", () => {
  it("PARENT_TYPE_CONTRACT.prd is exactly an empty array (no allowed parents)", () => {
    expect(PARENT_TYPE_CONTRACT.prd).toHaveLength(0);
  });

  it("PARENT_TYPE_CONTRACT.task contains exactly one entry: 'plan'", () => {
    expect(PARENT_TYPE_CONTRACT.task).toHaveLength(1);
    expect(Array.from(PARENT_TYPE_CONTRACT.task)).toContain("plan");
  });

  it("PARENT_TYPE_CONTRACT.spec contains exactly one entry: 'prd'", () => {
    expect(PARENT_TYPE_CONTRACT.spec).toHaveLength(1);
    expect(Array.from(PARENT_TYPE_CONTRACT.spec)).toContain("prd");
  });

  it("PARENT_TYPE_CONTRACT.knowledge contains all 5 other types plus itself (6 allowed parents per spec)", () => {
    // knowledge → ["prd", "spec", "adr", "plan", "knowledge"]
    const allowed = Array.from(PARENT_TYPE_CONTRACT.knowledge);
    expect(allowed).toHaveLength(5);
    expect(allowed).toContain("prd");
    expect(allowed).toContain("spec");
    expect(allowed).toContain("adr");
    expect(allowed).toContain("plan");
    expect(allowed).toContain("knowledge");
  });

  it("PARENT_TYPE_CONTRACT covers all 7 DocType keys (SPEC-056 T4 added 'phase')", () => {
    const keys = Object.keys(PARENT_TYPE_CONTRACT);
    expect(keys).toContain("prd");
    expect(keys).toContain("spec");
    expect(keys).toContain("adr");
    expect(keys).toContain("plan");
    expect(keys).toContain("task");
    expect(keys).toContain("knowledge");
    expect(keys).toContain("phase");
    expect(keys).toHaveLength(7);
  });

  it("phase → plan is a valid parent relationship (SPEC-056 D1)", () => {
    expect(isValidParentType("phase", "plan")).toBe(true);
  });

  it("PARENT_TYPE_CONTRACT.phase contains exactly one entry: 'plan'", () => {
    expect(PARENT_TYPE_CONTRACT.phase).toHaveLength(1);
    expect(Array.from(PARENT_TYPE_CONTRACT.phase)).toContain("plan");
  });

  it("knowledge → adr is valid (adr is within knowledge's allowed set)", () => {
    // Boundary: knowledge has the widest allowed parent set — verify adr (not just prd/spec)
    expect(isValidParentType("knowledge", "adr")).toBe(true);
  });
});

// ── REGRESSION guards ────────────────────────────────────────────────────────

describe("ROOT_TYPES — regression guard (AC-DOCTYPE-REGRESSION)", () => {
  it("[REGRESSION] ROOT_TYPES is exactly ['prd'] — prd is the only type with empty parent set", () => {
    // Per spec §3: only prd has [] in PARENT_TYPE_CONTRACT. No other type should be a root.
    expect(Array.from(ROOT_TYPES)).toEqual(["prd"]);
  });

  it("[REGRESSION] ROOT_TYPES does not include spec (spec requires prd as parent)", () => {
    expect(Array.from(ROOT_TYPES)).not.toContain("spec");
  });

  it("[REGRESSION] ROOT_TYPES does not include task (task requires plan as parent)", () => {
    expect(Array.from(ROOT_TYPES)).not.toContain("task");
  });

  it("[REGRESSION] ROOT_TYPES does not include knowledge (knowledge has 5 allowed parents)", () => {
    expect(Array.from(ROOT_TYPES)).not.toContain("knowledge");
  });

  it("[REGRESSION] isValidParentType is symmetric-aware: task→plan=true but plan→task=false", () => {
    expect(isValidParentType("task", "plan")).toBe(true);
    expect(isValidParentType("plan", "task")).toBe(false);
  });
});
