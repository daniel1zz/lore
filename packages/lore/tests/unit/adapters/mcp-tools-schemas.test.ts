/**
 * Unit tests for mcp/tools.ts schema constants.
 * Tests: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * Strategy: Parse each exported schema directly with valid and invalid inputs
 * to verify the schema constants are correctly defined and the registerTool
 * integration does not corrupt them.
 *
 * @spec_ref ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA §"Verification gates"
 */

import { describe, it, expect } from "vitest";
import {
  LoreCreateSchema,
  LoreGetSchema,
  LoreSetSchema,
  LoreDeleteSchema,
  LoreListSchema,
  LoreSearchSchema,
  LoreTreeSchema,
  LoreLinkSchema,
  LoreLogSchema,
  LoreDiffSchema,
  LorePendingSchema,
  LoreApproveSchema,
  LoreContextBundleSchema,
  LoreBatchSchema,
} from "../../../src/adapters/mcp/tools.js";

// ─── LoreCreateSchema ─────────────────────────────────────────────────────────

describe("LoreCreateSchema", () => {
  describe("happy path", () => {
    it("accepts minimal valid input (type + title)", () => {
      const result = LoreCreateSchema.safeParse({ type: "prd", title: "My PRD" });
      expect(result.success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const result = LoreCreateSchema.safeParse({
        type: "spec",
        title: "Auth Spec",
        content: "# Content",
        parent_id: "01AAAAAAAAAAAAAAAAAAAAAAAAA",
        tags: ["auth", "security"],
        extra: { key: "value" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("rejects missing title", () => {
      const result = LoreCreateSchema.safeParse({ type: "prd" });
      expect(result.success).toBe(false);
    });

    it("rejects missing type", () => {
      const result = LoreCreateSchema.safeParse({ title: "No Type" });
      expect(result.success).toBe(false);
    });
  });

  describe("boundary values", () => {
    it("accepts all valid doc type enum values", () => {
      const types = ["prd", "spec", "adr", "plan", "knowledge", "task"] as const;
      for (const type of types) {
        const result = LoreCreateSchema.safeParse({ type, title: "x" });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid doc type", () => {
      const result = LoreCreateSchema.safeParse({ type: "invalid", title: "x" });
      expect(result.success).toBe(false);
    });

    it("rejects empty title (min(1))", () => {
      const result = LoreCreateSchema.safeParse({ type: "prd", title: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("error path (safeParse on garbage input)", () => {
    it("returns failure with issues on completely invalid input", () => {
      const result = LoreCreateSchema.safeParse(null);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("state (deterministic re-parse)", () => {
    it("parses the same input identically on repeated calls", () => {
      const input = { type: "prd", title: "Stable" };
      const r1 = LoreCreateSchema.safeParse(input);
      const r2 = LoreCreateSchema.safeParse(input);
      expect(r1.success).toBe(r2.success);
      if (r1.success && r2.success) {
        expect(r1.data).toEqual(r2.data);
      }
    });
  });
});

// ─── LoreGetSchema ────────────────────────────────────────────────────────────

describe("LoreGetSchema", () => {
  describe("happy path", () => {
    it("accepts id_or_slug only", () => {
      const result = LoreGetSchema.safeParse({ id_or_slug: "prd-my-doc" });
      expect(result.success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const result = LoreGetSchema.safeParse({
        id_or_slug: "01AAAAAAAAAAAAAAAAAAAAAAAAA",
        resolve_mdx: true,
        include_navigation: false,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("rejects missing id_or_slug", () => {
      const result = LoreGetSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

// ─── LoreSetSchema ────────────────────────────────────────────────────────────

describe("LoreSetSchema", () => {
  describe("happy path", () => {
    it("accepts id_or_slug with partial update", () => {
      const result = LoreSetSchema.safeParse({
        id_or_slug: "prd-my-doc",
        title: "New Title",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("boundary values", () => {
    it("accepts all valid status enum values", () => {
      const statuses = ["draft", "in-review", "approved", "active", "archived", "deprecated"] as const;
      for (const status of statuses) {
        const result = LoreSetSchema.safeParse({ id_or_slug: "x", status });
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid status", () => {
      const result = LoreSetSchema.safeParse({ id_or_slug: "x", status: "invalid" });
      expect(result.success).toBe(false);
    });
  });

  describe("negative cases", () => {
    it("rejects missing id_or_slug", () => {
      const result = LoreSetSchema.safeParse({ title: "No ID" });
      expect(result.success).toBe(false);
    });
  });
});

// ─── LoreDeleteSchema ─────────────────────────────────────────────────────────

describe("LoreDeleteSchema", () => {
  describe("happy path", () => {
    it("accepts id_or_slug + confirm:true", () => {
      const result = LoreDeleteSchema.safeParse({ id_or_slug: "prd-x", confirm: true });
      expect(result.success).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("rejects confirm:false (z.literal(true) requires exactly true)", () => {
      const result = LoreDeleteSchema.safeParse({ id_or_slug: "prd-x", confirm: false });
      expect(result.success).toBe(false);
    });

    it("rejects missing confirm", () => {
      const result = LoreDeleteSchema.safeParse({ id_or_slug: "prd-x" });
      expect(result.success).toBe(false);
    });
  });
});

// ─── LoreListSchema ───────────────────────────────────────────────────────────

describe("LoreListSchema", () => {
  describe("happy path", () => {
    it("accepts empty object (all optional)", () => {
      const result = LoreListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts all filters simultaneously", () => {
      const result = LoreListSchema.safeParse({
        type: "prd",
        status: "active",
        since: "2024-01-01",
        author: "alice",
        tag: "core",
        limit: 10,
        offset: 0,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("boundary values", () => {
    it("rejects limit=0 (positive())", () => {
      const result = LoreListSchema.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects offset=-1 (min(0))", () => {
      const result = LoreListSchema.safeParse({ offset: -1 });
      expect(result.success).toBe(false);
    });
  });
});

// ─── LoreSearchSchema ─────────────────────────────────────────────────────────

describe("LoreSearchSchema", () => {
  describe("happy path", () => {
    it("accepts query string", () => {
      const result = LoreSearchSchema.safeParse({ query: "authentication" });
      expect(result.success).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("rejects empty query (min(1))", () => {
      const result = LoreSearchSchema.safeParse({ query: "" });
      expect(result.success).toBe(false);
    });

    it("rejects missing query", () => {
      const result = LoreSearchSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

// ─── LoreLinkSchema ───────────────────────────────────────────────────────────

describe("LoreLinkSchema", () => {
  describe("happy path", () => {
    it("accepts from+to with default type", () => {
      const result = LoreLinkSchema.safeParse({ from: "id-a", to: "id-b" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("relates-to");
      }
    });

    it("accepts all valid link type enum values", () => {
      const types = ["parent", "implements", "informs", "supersedes", "relates-to", "blocks"] as const;
      for (const type of types) {
        const result = LoreLinkSchema.safeParse({ from: "a", to: "b", type });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("negative cases", () => {
    it("rejects missing from", () => {
      const result = LoreLinkSchema.safeParse({ to: "id-b" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid link type", () => {
      const result = LoreLinkSchema.safeParse({ from: "a", to: "b", type: "unknown" });
      expect(result.success).toBe(false);
    });
  });
});

// ─── LoreBatchSchema ──────────────────────────────────────────────────────────

describe("LoreBatchSchema", () => {
  describe("happy path", () => {
    it("accepts valid operations array", () => {
      const result = LoreBatchSchema.safeParse({
        operations: [
          { op: "create", args: { type: "prd", title: "Batch PRD" } },
          { op: "list", args: {} },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty operations array", () => {
      const result = LoreBatchSchema.safeParse({ operations: [] });
      expect(result.success).toBe(true);
    });
  });

  describe("negative cases", () => {
    it("rejects missing operations", () => {
      const result = LoreBatchSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts unknown op value (op is z.string(), executor handles default case)", () => {
      // reason: op is z.string() not z.enum([...]) so unknown ops reach executeBatchOp's
      // default branch and return { ok: false } in results, not a schema error.
      // This preserves the behavior where the batch itself doesn't fail for unknown ops.
      const result = LoreBatchSchema.safeParse({
        operations: [{ op: "unknown_op", args: {} }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("error path (safeParse on garbage)", () => {
    it("returns failure with issues on null input", () => {
      const result = LoreBatchSchema.safeParse(null);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });
});

// ─── LoreLogSchema / LoreDiffSchema ───────────────────────────────────────────

describe("LoreLogSchema", () => {
  it("accepts id_or_slug only", () => {
    const result = LoreLogSchema.safeParse({ id_or_slug: "prd-x" });
    expect(result.success).toBe(true);
  });

  it("accepts id_or_slug + limit", () => {
    const result = LoreLogSchema.safeParse({ id_or_slug: "prd-x", limit: 5 });
    expect(result.success).toBe(true);
  });

  it("rejects missing id_or_slug", () => {
    const result = LoreLogSchema.safeParse({ limit: 5 });
    expect(result.success).toBe(false);
  });
});

describe("LoreDiffSchema", () => {
  it("accepts id_or_slug only", () => {
    const result = LoreDiffSchema.safeParse({ id_or_slug: "prd-x" });
    expect(result.success).toBe(true);
  });

  it("accepts from + to versions", () => {
    const result = LoreDiffSchema.safeParse({ id_or_slug: "prd-x", from: 1, to: 3 });
    expect(result.success).toBe(true);
  });
});

describe("LorePendingSchema", () => {
  it("accepts empty object", () => {
    const result = LorePendingSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid type", () => {
    const result = LorePendingSchema.safeParse({ type: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("LoreApproveSchema", () => {
  it("accepts id_or_slug only", () => {
    const result = LoreApproveSchema.safeParse({ id_or_slug: "prd-x" });
    expect(result.success).toBe(true);
  });

  it("rejects missing id_or_slug", () => {
    const result = LoreApproveSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("LoreContextBundleSchema", () => {
  it("accepts id_or_slug", () => {
    const result = LoreContextBundleSchema.safeParse({ id_or_slug: "prd-x" });
    expect(result.success).toBe(true);
  });

  it("accepts id_or_slug + max_depth", () => {
    const result = LoreContextBundleSchema.safeParse({ id_or_slug: "prd-x", max_depth: 3 });
    expect(result.success).toBe(true);
  });
});

// ─── LoreTreeSchema ───────────────────────────────────────────────────────────

describe("LoreTreeSchema", () => {
  it("accepts empty object (all optional)", () => {
    const result = LoreTreeSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts root + depth", () => {
    const result = LoreTreeSchema.safeParse({ root: "prd-x", depth: 2 });
    expect(result.success).toBe(true);
  });
});
