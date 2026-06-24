/**
 * @spec_ref TECH-01KV4W88GZF74B98BHCBBV9GHD §3 (lore.tree.yaml schema)
 *
 * RED-phase tests for src/core/tree-blueprint.ts
 * These tests MUST fail until the implementation module is created.
 *
 * Test design (spec-first, before reading implementation):
 * TreeBlueprint:
 *   { version: 1; root: TreeNodeSpec }
 *
 * TreeNodeSpec:
 *   { type: DocType; slug?: string; min: number (≥0, default 0);
 *     max: number|null (positive or null, default null); children: TreeNodeSpec[] }
 *
 * parseTreeBlueprint(raw: string): Result<TreeBlueprint, LoreError>
 *   - Parses YAML string
 *   - Validates with Zod schema (treeBlueprintSchema)
 *   - YAML parse failure → VALIDATION_ERROR { field: "lore.tree.yaml", message: "YAML parse failed: ..." }
 *   - Schema violation (max < min) → VALIDATION_ERROR { field: "lore.tree.yaml", message: "max (...) must be >= min (...)" }
 *   - version !== 1 → fails Zod z.literal(1)
 *   - max: 0 → rejected (must be positive integer or null)
 *   - Negative min → rejected (non-negative int)
 *   - Returns Result<T, LoreError> via ok()/err()
 *
 * treeBlueprintSchema: ZodType<TreeBlueprint>
 *   - version: z.literal(1)
 *   - root: TreeNodeSpec schema
 *   - superRefine: max === null || max >= min
 *
 * Dimensions:
 * HAPPY: valid minimal blueprint; blueprint with slug; nested children; max=null default
 * NEGATIVE: max < min; missing root; version !== 1; max = 0 (not positive); negative min
 * BOUNDARY: min=0 max=null (defaults); min=1 max=1 (equal — valid); very deeply nested
 * ERROR: malformed YAML (not valid YAML syntax); empty string; null-ish YAML
 * STATE: same input twice → identical ok result (pure function)
 * REGRESSION: YAML parse failure message MUST contain "YAML parse failed:" prefix
 */

import { describe, it, expect } from "vitest";
import {
  parseTreeBlueprint,
  treeBlueprintSchema,
  type TreeBlueprint,
  type TreeNodeSpec,
} from "../../../src/core/tree-blueprint.js";

// ── HAPPY path ───────────────────────────────────────────────────────────────

describe("parseTreeBlueprint — happy path (AC-TREEBP-HAPPY)", () => {
  it("minimal valid blueprint with version:1 and a root node parses successfully", () => {
    const yaml = `
version: 1
root:
  type: prd
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.version).toBe(1);
      expect(result.value.root.type).toBe("prd");
    }
  });

  it("root node with explicit min=0 and max=null defaults accepted", () => {
    const yaml = `
version: 1
root:
  type: prd
  min: 0
  max: null
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.min).toBe(0);
      expect(result.value.root.max).toBeNull();
    }
  });

  it("root node without explicit min/max uses defaults (min=0, max=null)", () => {
    const yaml = `
version: 1
root:
  type: spec
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.min).toBe(0);
      expect(result.value.root.max).toBeNull();
    }
  });

  it("blueprint with optional slug on root node is accepted", () => {
    const yaml = `
version: 1
root:
  type: prd
  slug: prd-main
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.slug).toBe("prd-main");
    }
  });

  it("blueprint with nested children array is accepted", () => {
    const yaml = `
version: 1
root:
  type: prd
  children:
    - type: spec
      min: 1
      max: 10
    - type: adr
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.children).toHaveLength(2);
      expect(result.value.root.children[0]?.type).toBe("spec");
      expect(result.value.root.children[1]?.type).toBe("adr");
    }
  });

  it("valid blueprint with min=1 max=1 (equal values) is accepted", () => {
    const yaml = `
version: 1
root:
  type: plan
  min: 1
  max: 1
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.min).toBe(1);
      expect(result.value.root.max).toBe(1);
    }
  });

  it("valid blueprint with max=5 (positive int) is accepted", () => {
    const yaml = `
version: 1
root:
  type: prd
  min: 0
  max: 5
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.max).toBe(5);
    }
  });
});

// ── NEGATIVE cases ────────────────────────────────────────────────────────────

describe("parseTreeBlueprint — negative cases (AC-TREEBP-NEG)", () => {
  it("[AC-TREEBP-NEG-001] max < min produces VALIDATION_ERROR with correct field", () => {
    const yaml = `
version: 1
root:
  type: spec
  min: 5
  max: 3
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("lore.tree.yaml");
      // spec §3: message must mention max and min values
      expect(result.error.message).toContain("max");
      expect(result.error.message).toContain("min");
    }
  });

  it("[AC-TREEBP-NEG-002] version !== 1 (version: 2) produces a parse failure", () => {
    const yaml = `
version: 2
root:
  type: prd
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
  });

  it("[AC-TREEBP-NEG-003] version: 'one' (string instead of literal 1) produces a parse failure", () => {
    const yaml = `
version: "one"
root:
  type: prd
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
  });

  it("[AC-TREEBP-NEG-004] max=0 is rejected (max must be positive integer or null)", () => {
    const yaml = `
version: 1
root:
  type: prd
  min: 0
  max: 0
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
  });

  it("[AC-TREEBP-NEG-005] negative min is rejected (min must be non-negative integer)", () => {
    const yaml = `
version: 1
root:
  type: prd
  min: -1
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
  });

  it("[AC-TREEBP-NEG-006] missing root field produces a parse failure", () => {
    const yaml = `
version: 1
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
  });

  it("[AC-TREEBP-NEG-007] invalid DocType in root.type is rejected", () => {
    const yaml = `
version: 1
root:
  type: blog
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
  });

  it("[AC-TREEBP-NEG-008] max<min in nested child node also triggers VALIDATION_ERROR", () => {
    const yaml = `
version: 1
root:
  type: prd
  children:
    - type: spec
      min: 10
      max: 2
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

// ── BOUNDARY values ───────────────────────────────────────────────────────────

describe("parseTreeBlueprint — boundary values (AC-TREEBP-BOUNDARY)", () => {
  it("[boundary] min=0 max=null (both defaults) is the minimum valid spec", () => {
    const yaml = `
version: 1
root:
  type: knowledge
  min: 0
  max: null
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
  });

  it("[boundary] empty children array (explicitly set) is accepted", () => {
    const yaml = `
version: 1
root:
  type: prd
  children: []
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.children).toHaveLength(0);
    }
  });

  it("[boundary] deeply nested blueprint (3 levels) is accepted", () => {
    const yaml = `
version: 1
root:
  type: prd
  children:
    - type: spec
      children:
        - type: task
          min: 0
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.children[0]?.type).toBe("spec");
      expect(result.value.root.children[0]?.children[0]?.type).toBe("task");
    }
  });

  it("[boundary] min=1 max=2 (max > min) is valid", () => {
    const yaml = `
version: 1
root:
  type: plan
  min: 1
  max: 2
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(true);
  });

  it("[boundary] max=1 min=2 (max < min by 1) triggers the exact VALIDATION_ERROR message format", () => {
    const yaml = `
version: 1
root:
  type: plan
  min: 2
  max: 1
`;
    const result = parseTreeBlueprint(yaml);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("lore.tree.yaml");
      // spec §3: "max (...) must be >= min (...)"
      expect(result.error.message).toMatch(/max.*must be.*>=.*min/i);
    }
  });
});

// ── ERROR cases (malformed input) ─────────────────────────────────────────────

describe("parseTreeBlueprint — error handling (AC-TREEBP-ERROR)", () => {
  it("[AC-TREEBP-ERROR-001] malformed YAML text produces VALIDATION_ERROR with 'YAML parse failed:' prefix", () => {
    const badYaml = `
version: 1
root:
  type: prd
  : invalid: yaml: here: {{{{
`;
    const result = parseTreeBlueprint(badYaml);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("lore.tree.yaml");
      expect(result.error.message).toContain("YAML parse failed:");
    }
  });

  it("[AC-TREEBP-ERROR-002] empty string input produces VALIDATION_ERROR (fail loud, not silent null)", () => {
    const result = parseTreeBlueprint("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("[AC-TREEBP-ERROR-003] YAML string that is just a scalar (not an object) produces VALIDATION_ERROR", () => {
    const result = parseTreeBlueprint("just a plain string");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("[AC-TREEBP-ERROR-004] completely garbled binary-like input produces VALIDATION_ERROR", () => {
    const result = parseTreeBlueprint("\x00\x01\xFF\xFE");
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("lore.tree.yaml");
    }
  });

  it("[AC-TREEBP-ERROR-005] result is never a thrown exception — errors are returned as Result, not thrown", () => {
    // If parseTreeBlueprint throws instead of returning err(), this test catches it
    expect(() => parseTreeBlueprint("{{{{ invalid yaml")).not.toThrow();
  });
});

// ── STATE / purity ────────────────────────────────────────────────────────────

describe("parseTreeBlueprint — state / purity (AC-TREEBP-STATE)", () => {
  it("[AC-TREEBP-STATE-001] calling twice with the same valid input returns identical results", () => {
    const yaml = `
version: 1
root:
  type: prd
  min: 0
  max: null
`;
    const first = parseTreeBlueprint(yaml);
    const second = parseTreeBlueprint(yaml);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value).toEqual(first.value);
    }
  });

  it("[AC-TREEBP-STATE-002] calling twice with the same invalid input returns identical errors", () => {
    const yaml = `
version: 1
root:
  type: spec
  min: 10
  max: 1
`;
    const first = parseTreeBlueprint(yaml);
    const second = parseTreeBlueprint(yaml);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (!first.ok && !second.ok) {
      expect(second.error.code).toBe(first.error.code);
      if (first.error.code === "VALIDATION_ERROR" && second.error.code === "VALIDATION_ERROR") {
        expect(second.error.field).toBe(first.error.field);
      }
    }
  });
});

// ── REGRESSION guards ─────────────────────────────────────────────────────────

describe("parseTreeBlueprint — regression guards (AC-TREEBP-REGRESSION)", () => {
  it("[REGRESSION] YAML parse failure message MUST start with 'YAML parse failed:' (fail loud contract)", () => {
    // Regression: must not silently return null or a generic error without the "YAML parse failed:" prefix
    const badYaml = `{ unclosed: [bracket`;
    const result = parseTreeBlueprint(badYaml);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("lore.tree.yaml");
      expect(result.error.message).toMatch(/^YAML parse failed:/);
    }
  });

  it("[REGRESSION] treeBlueprintSchema is exported as a Zod schema (usable for .safeParse)", () => {
    // If the schema is not exported or is undefined, this test will fail with module-level TypeError
    expect(treeBlueprintSchema).toBeDefined();
    expect(typeof treeBlueprintSchema.safeParse).toBe("function");
  });

  it("[REGRESSION] parseTreeBlueprint does not silently fall back to a default on missing root (fail loud)", () => {
    // spec CLAUDE.md rule: must fail loud, not return a default blueprint
    const yaml = `version: 1`;
    const result = parseTreeBlueprint(yaml);
    // Must be an error, never a silently constructed default root
    expect(result.ok).toBe(false);
  });

  it("[REGRESSION] max=null is preserved and not coerced to 0 or another number", () => {
    const yaml = `
version: 1
root:
  type: prd
`;
    const result = parseTreeBlueprint(yaml);
    if (result.ok) {
      // default max must be null, not 0 or undefined
      expect(result.value.root.max).toBeNull();
      expect(result.value.root.max).not.toBe(0);
    }
  });
});
