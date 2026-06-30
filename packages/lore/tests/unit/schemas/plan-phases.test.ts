/**
 * Unit tests for plan phase schema validation (planExtraSchema, planPhaseSchema, taskExtraSchema).
 * Pure Zod parsing — no store, no services.
 *
 * Adversarial targets:
 *   - planExtraSchema.phases uniqueness enforced by superRefine at the COLLIDING INDEX (not first).
 *     A test that only checks the error code would miss a wrong path/index in the issue.
 *   - Max 30 phases (hard cap). Test 30 → accepted, 31 → rejected.
 *   - planPhaseSchema requires name.min(1) — empty string must be rejected.
 *   - taskExtraSchema.phase is truly optional — absence must not cause errors.
 *
 * @spec_ref AC-PHASE-1 AC-PHASE-2 SPEC-023 §4 §6
 */

import { describe, it, expect } from "vitest";
import { planExtraSchema, planPhaseSchema, taskExtraSchema } from "@lore/core";

// ─── planPhaseSchema ──────────────────────────────────────────────────────────

describe("planPhaseSchema", () => {
  it("AC-PHASE-1.schema.H1: accepts phase with name only", () => {
    const result = planPhaseSchema.safeParse({ name: "Alpha" });
    expect(result.success).toBe(true);
  });

  it("AC-PHASE-1.schema.H2: accepts phase with name and description", () => {
    const result = planPhaseSchema.safeParse({
      name: "Foundation",
      description: "Core infrastructure work",
    });
    expect(result.success).toBe(true);
  });

  it("AC-PHASE-1.schema.N1: rejects phase with empty string name", () => {
    const result = planPhaseSchema.safeParse({ name: "" });
    // Spec: planPhaseSchema requires name min length 1.
    expect(result.success).toBe(false);
  });

  it("AC-PHASE-1.schema.N2: rejects phase missing name field entirely", () => {
    const result = planPhaseSchema.safeParse({ description: "No name" });
    expect(result.success).toBe(false);
  });
});

// ─── planExtraSchema — phases uniqueness ────────────────────────────────────

describe("planExtraSchema — phases uniqueness", () => {
  it("AC-PHASE-1.unique.H1: accepts phases array with all unique names", () => {
    const result = planExtraSchema.safeParse({
      phases: [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }],
    });
    expect(result.success).toBe(true);
  });

  it("AC-PHASE-1.unique.N1: rejects duplicate phase names (same name at index 0 and 2)", () => {
    const result = planExtraSchema.safeParse({
      phases: [{ name: "Alpha" }, { name: "Beta" }, { name: "Alpha" }],
    });
    // Spec AC-PHASE-1: uniqueness enforced via superRefine — duplicates raise issue at colliding index.
    expect(result.success).toBe(false);
  });

  it("AC-PHASE-1.unique.N2: duplicate issue path points to the COLLIDING (second) occurrence index", () => {
    const result = planExtraSchema.safeParse({
      phases: [{ name: "Dup" }, { name: "Dup" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    // Spec: "duplicates raise a custom phases[].name issue at the colliding index"
    // The colliding index is 1 (second occurrence), not 0 (first).
    const issue = result.error.issues.find((i) =>
      i.path.includes("phases") && i.path.includes("name"),
    );
    expect(issue).toBeDefined();
    // The path should be ["phases", 1, "name"] — index 1 is the duplicate.
    expect(issue?.path[1]).toBe(1);
    expect(issue?.message).toContain("unique");
  });

  it("AC-PHASE-1.unique.N3: two separate duplicates yield two issues (both collisions flagged)", () => {
    const result = planExtraSchema.safeParse({
      phases: [
        { name: "Alpha" },
        { name: "Beta" },
        { name: "Alpha" }, // dup of index 0
        { name: "Beta" },  // dup of index 1
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const uniqueIssues = result.error.issues.filter((i) => i.message?.includes("unique"));
    // Both duplicate occurrences at index 2 and 3 should each have a uniqueness issue.
    expect(uniqueIssues.length).toBeGreaterThanOrEqual(2);
  });

  it("AC-PHASE-1.unique.B1: case-sensitive — 'Alpha' and 'alpha' are NOT duplicates", () => {
    const result = planExtraSchema.safeParse({
      phases: [{ name: "Alpha" }, { name: "alpha" }],
    });
    // Spec §8 Q-extra: matching is case-sensitive.
    expect(result.success).toBe(true);
  });
});

// ─── planExtraSchema — phases max 30 ────────────────────────────────────────

describe("planExtraSchema — phases max 30", () => {
  it("AC-PHASE-1.max.B1: accepts exactly 30 phases (boundary: at limit)", () => {
    const phases = Array.from({ length: 30 }, (_, i) => ({ name: `Phase ${i + 1}` }));
    const result = planExtraSchema.safeParse({ phases });
    // Spec §6: hard cap of 30 via .max(30).
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phases).toHaveLength(30);
  });

  it("AC-PHASE-1.max.N1: rejects 31 phases (one over the hard cap)", () => {
    const phases = Array.from({ length: 31 }, (_, i) => ({ name: `Phase ${i + 1}` }));
    const result = planExtraSchema.safeParse({ phases });
    // Spec §6: max 30 phases — 31 must be rejected.
    expect(result.success).toBe(false);
  });

  it("AC-PHASE-1.max.B2: empty phases array is valid (no minimum)", () => {
    const result = planExtraSchema.safeParse({ phases: [] });
    expect(result.success).toBe(true);
  });
});

// ─── planExtraSchema — optional phases field ─────────────────────────────────

describe("planExtraSchema — phases field optionality", () => {
  it("AC-PHASE-1.opt.H1: plan extra without phases field is valid (backward compat)", () => {
    const result = planExtraSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("AC-PHASE-1.opt.H2: plan extra with legacy singular phase string is still accepted", () => {
    // planExtraSchema still accepts the legacy singular `phase` field for backward compat.
    const result = planExtraSchema.safeParse({ phase: "Track A" });
    // Spec §8 Q2: legacy field remains in schema until explicitly removed after migration.
    expect(result.success).toBe(true);
  });

  it("AC-PHASE-1.opt.H3: plan extra with new phases array AND legacy phase string coexist", () => {
    // Both fields can coexist during transition period.
    const result = planExtraSchema.safeParse({
      phase: "legacy value",
      phases: [{ name: "Phase A" }],
      legacy_phase: "archived",
    });
    expect(result.success).toBe(true);
  });
});

// ─── taskExtraSchema — optional phase field ───────────────────────────────────

describe("taskExtraSchema — AC-PHASE-2 optional phase field", () => {
  it("AC-PHASE-2.H1: accepts task extra with phase string", () => {
    const result = taskExtraSchema.safeParse({
      plan_id: "01AAAAAAAAAAAAAAAAAAAAAAA0",
      phase: "Alpha",
    });
    // Spec AC-PHASE-2: taskExtraSchema.phase accepts an optional string.
    expect(result.success).toBe(true);
  });

  it("AC-PHASE-2.H2: accepts task extra WITHOUT phase (field is optional)", () => {
    const result = taskExtraSchema.safeParse({
      plan_id: "01AAAAAAAAAAAAAAAAAAAAAAA0",
    });
    // Spec AC-PHASE-4: task without extra.phase is always valid at schema level.
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data["phase"]).toBeUndefined();
  });

  it("AC-PHASE-2.B1: accepts phase as empty string (Zod accepts; service-layer enforces semantic validity)", () => {
    // Note: empty string is technically a string, so Zod accepts it.
    // The service layer rejects it because no plan phase is named "".
    // This test verifies schema-level behavior only (not service-level).
    const result = taskExtraSchema.safeParse({
      plan_id: "01AAAAAAAAAAAAAAAAAAAAAAA0",
      phase: "",
    });
    // taskExtraSchema uses z.string().optional() — no min(1), so "" is allowed by schema.
    expect(result.success).toBe(true);
  });
});
