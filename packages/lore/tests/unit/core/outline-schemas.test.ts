/** @spec_ref AC-080-3 */
import { describe, it, expect } from "vitest";
import {
  outlineBudgetSchema,
  createDocInputSchema,
  SPEC_KINDS,
} from "@lore/core";

// RED-phase test file for SPEC-080 C1/C2/C3 schema shapes (paired with T1
// implementation task `task-skill-implement-t1-core-schemas-outlineentry-outline`,
// which is expected to make this whole file GREEN without editing it).
//
// `outlineEntrySchema` / `outlineBudgetSchema` do not exist
// yet (packages/core/src/outline.ts is unwritten, and `SPEC_KINDS` has not yet been
// extended with "domain-overview") — every scenario below is expected to fail RED
// today, either because the imported schema is `undefined` (module-not-found /
// undefined-export) or because the current SPEC_KINDS tuple does not contain
// "domain-overview".
//
// Test plan (SPEC-080 C1 OutlineEntry / C2 SPEC_KINDS+domain-overview / C3 outline_budget):
// HAPPY: valid OutlineEntry parses + preserves all 7 fields; each declared tier/rel value
//   accepts; spec_kind="domain-overview" is accepted by createDocInputSchema.
// NEGATIVE: unknown tier rejected (names `tier`); links.rel outside the enum rejected
//   (names `rel`); spec_kind typo "domain-orview" rejected.
// BOUNDARY: non-positive outline_budget section values (zero and negative) rejected;
//   extra_prose_chars defaults to 1000 when absent.
// ERROR: N/A — pure Zod parsing, no external IO / no thrown exceptions expected from
//   the schemas themselves (only from the RED-phase missing-implementation import).
// STATE: N/A — schemas are stateless parse functions.
// REGRESSION: N/A — new module, nothing pre-existing to regress.

const VALID_PARENT_ID = "01J5X7KZRF4AXRHX9WKE6DVP6P";

describe("outlineBudgetSchema (SPEC-080 C3)", () => {
  const validBudget = {
    core_max_chars: 4000,
    domain_max_chars: 2000,
    whole_body_max_chars: 24000,
    extra_prose_chars: 1000,
  };

  it("accepts a fully-specified valid budget", () => {
    const result = outlineBudgetSchema.safeParse(validBudget);
    expect(result.success).toBe(true);
  });

  it("[boundary] extra_prose_chars defaults to 1000 when absent (SPEC-080 C3 stated default)", () => {
    const { extra_prose_chars, ...rest } = validBudget;
    const result = outlineBudgetSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as { extra_prose_chars: number }).extra_prose_chars).toBe(1000);
    }
  });

  it("[negative] rejects a zero domain_max_chars (non-positive section budget)", () => {
    const result = outlineBudgetSchema.safeParse({ ...validBudget, domain_max_chars: 0 });
    expect(result.success).toBe(false);
  });

  it("[negative] rejects a negative core_max_chars (non-positive section budget)", () => {
    const result = outlineBudgetSchema.safeParse({ ...validBudget, core_max_chars: -100 });
    expect(result.success).toBe(false);
  });

  it("[negative] rejects a zero whole_body_max_chars", () => {
    const result = outlineBudgetSchema.safeParse({ ...validBudget, whole_body_max_chars: 0 });
    expect(result.success).toBe(false);
  });

  it("[negative] rejects a negative extra_prose_chars", () => {
    const result = outlineBudgetSchema.safeParse({ ...validBudget, extra_prose_chars: -1 });
    expect(result.success).toBe(false);
  });
});

describe("SPEC_KINDS domain-overview extension + createDocInputSchema (SPEC-080 C2)", () => {
  it("SPEC_KINDS includes 'domain-overview'", () => {
    expect((SPEC_KINDS as readonly string[]).includes("domain-overview")).toBe(true);
  });

  it("createDocInputSchema accepts spec_kind='domain-overview'", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Feedback Loop Domain Overview",
      extra: { spec_kind: "domain-overview" },
    });
    expect(result.success).toBe(true);
  });

  it("[negative] createDocInputSchema rejects the typo 'domain-orview'", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "Feedback Loop Domain Overview",
      extra: { spec_kind: "domain-orview" },
    });
    expect(result.success).toBe(false);
  });
});
