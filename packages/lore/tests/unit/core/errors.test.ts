/** @spec_ref AC-CORE-006 */
import { describe, it, expect } from "vitest";
import { ok, err, type Result, type LoreError } from "@lore/core";

// Test plan for errors module:
// HAPPY: ok() wraps value, err() wraps error, all 12 LoreError codes constructable
// NEGATIVE: N/A — error constructors are type-safe by TypeScript compile-time system
// BOUNDARY: empty collections, zero values, empty strings
// ERROR: N/A — no external dependencies
// STATE: N/A — stateless functions
// REGRESSION: N/A — no known regressions

describe("ok()", () => {
  it("returns ok=true with numeric value", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it("wraps string value", () => {
    const result = ok("hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("hello");
    }
  });

  it("wraps object value", () => {
    const result = ok({ id: "abc", name: "test" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ id: "abc", name: "test" });
    }
  });

  it("wraps null value", () => {
    const result = ok(null);
    expect(result.ok).toBe(true);
  });

  it("[boundary] wraps 0", () => {
    const result = ok(0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
  });

  it("[boundary] wraps empty string", () => {
    const result = ok("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("");
    }
  });

  it("[boundary] wraps empty array", () => {
    const result = ok([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });
});

describe("err()", () => {
  it("returns ok=false with error", () => {
    const error: LoreError = {
      code: "DOC_NOT_FOUND",
      id: "01J5X7KZRF4AXRHX9WKE6DVP6P",
    };
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(error);
    }
  });

  it("preserves all error fields", () => {
    const error: LoreError = {
      code: "STALE_VERSION",
      id: "abc",
      expected: 3,
      actual: 5,
    };
    const result = err(error);
    if (!result.ok) {
      expect(result.error.code).toBe("STALE_VERSION");
    }
  });
});

describe("LoreError — all 12 codes constructable (AC-CORE-005)", () => {
  it("AC-CORE-005.01: DOC_NOT_FOUND with id", () => {
    const e: LoreError = { code: "DOC_NOT_FOUND", id: "abc123" };
    expect(e.code).toBe("DOC_NOT_FOUND");
  });

  it("DOC_NOT_FOUND with optional suggestions", () => {
    const e: LoreError = {
      code: "DOC_NOT_FOUND",
      id: "abc123",
      suggestions: ["spec-auth", "spec-authz"],
    };
    if (e.code === "DOC_NOT_FOUND") {
      expect(e.suggestions).toHaveLength(2);
    }
  });

  it("AC-CORE-005.02: SLUG_NOT_FOUND with slug", () => {
    const e: LoreError = { code: "SLUG_NOT_FOUND", slug: "prd-auth" };
    expect(e.code).toBe("SLUG_NOT_FOUND");
  });

  it("SLUG_NOT_FOUND with optional suggestions", () => {
    const e: LoreError = {
      code: "SLUG_NOT_FOUND",
      slug: "prd-auth",
      suggestions: ["prd-auth-v2"],
    };
    expect(e.code).toBe("SLUG_NOT_FOUND");
  });

  it("AC-CORE-005.03: STALE_VERSION with id, expected, actual", () => {
    const e: LoreError = {
      code: "STALE_VERSION",
      id: "abc123",
      expected: 3,
      actual: 5,
    };
    expect(e.code).toBe("STALE_VERSION");
    if (e.code === "STALE_VERSION") {
      expect(e.expected).toBe(3);
      expect(e.actual).toBe(5);
    }
  });

  it("AC-CORE-005.04: VALIDATION_ERROR with field and message", () => {
    const e: LoreError = {
      code: "VALIDATION_ERROR",
      field: "parent_id",
      message: "required for spec type",
    };
    expect(e.code).toBe("VALIDATION_ERROR");
  });

  it("VALIDATION_ERROR with optional value", () => {
    const e: LoreError = {
      code: "VALIDATION_ERROR",
      field: "status",
      message: "invalid value",
      value: "unknown-status",
    };
    if (e.code === "VALIDATION_ERROR") {
      expect(e.value).toBe("unknown-status");
    }
  });

  it("AC-CORE-005.05: SCHEMA_VIOLATION with type and missing", () => {
    const e: LoreError = {
      code: "SCHEMA_VIOLATION",
      type: "adr",
      missing: ["decision_status"],
    };
    expect(e.code).toBe("SCHEMA_VIOLATION");
    if (e.code === "SCHEMA_VIOLATION") {
      expect(e.missing).toContain("decision_status");
    }
  });

  it("SCHEMA_VIOLATION with optional extra", () => {
    const e: LoreError = {
      code: "SCHEMA_VIOLATION",
      type: "adr",
      missing: ["decision_status"],
      extra: ["unknown_field"],
    };
    if (e.code === "SCHEMA_VIOLATION") {
      expect(e.extra).toContain("unknown_field");
    }
  });

  it("AC-CORE-005.06: LINK_CYCLE with path array", () => {
    const e: LoreError = {
      code: "LINK_CYCLE",
      path: ["doc-a", "doc-b", "doc-a"],
    };
    expect(e.code).toBe("LINK_CYCLE");
    if (e.code === "LINK_CYCLE") {
      expect(e.path).toHaveLength(3);
    }
  });

  it("AC-CORE-005.07: DUPLICATE_SLUG with slug and existing_id", () => {
    const e: LoreError = {
      code: "DUPLICATE_SLUG",
      slug: "spec-auth",
      existing_id: "01J5X7KZRF4AX",
    };
    expect(e.code).toBe("DUPLICATE_SLUG");
  });

  it("AC-CORE-005.08: DUPLICATE_LINK with from, to, type", () => {
    const e: LoreError = {
      code: "DUPLICATE_LINK",
      from: "doc-a",
      to: "doc-b",
      type: "implements",
    };
    expect(e.code).toBe("DUPLICATE_LINK");
  });

  it("AC-CORE-005.09: DELETE_REQUIRES_CONFIRM with id", () => {
    const e: LoreError = {
      code: "DELETE_REQUIRES_CONFIRM",
      id: "01J5X7KZRF4AX",
    };
    expect(e.code).toBe("DELETE_REQUIRES_CONFIRM");
  });

  it("AC-CORE-005.10: INVALID_TRANSITION with from, to, allowed", () => {
    const e: LoreError = {
      code: "INVALID_TRANSITION",
      from: "archived",
      to: "approved",
      allowed: ["deprecated"],
    };
    expect(e.code).toBe("INVALID_TRANSITION");
    if (e.code === "INVALID_TRANSITION") {
      expect(e.allowed).toContain("deprecated");
    }
  });

  it("AC-CORE-005.11: PARENT_REQUIRED with type", () => {
    const e: LoreError = { code: "PARENT_REQUIRED", type: "spec" };
    expect(e.code).toBe("PARENT_REQUIRED");
  });

  it("AC-CORE-005.12: STORE_ERROR with message", () => {
    const e: LoreError = {
      code: "STORE_ERROR",
      message: "disk full",
    };
    expect(e.code).toBe("STORE_ERROR");
  });

  it("STORE_ERROR with optional cause", () => {
    const cause = new Error("underlying error");
    const e: LoreError = {
      code: "STORE_ERROR",
      message: "disk full",
      cause,
    };
    if (e.code === "STORE_ERROR") {
      expect(e.cause).toBe(cause);
    }
  });

  it("[boundary] LINK_CYCLE with empty path", () => {
    const e: LoreError = { code: "LINK_CYCLE", path: [] };
    expect(e.code).toBe("LINK_CYCLE");
  });

  it("[boundary] SCHEMA_VIOLATION with empty missing array", () => {
    const e: LoreError = {
      code: "SCHEMA_VIOLATION",
      type: "prd",
      missing: [],
    };
    if (e.code === "SCHEMA_VIOLATION") {
      expect(e.missing).toHaveLength(0);
    }
  });
});

describe("Result type narrowing (AC-CORE-006)", () => {
  it("AC-CORE-006.01: ok(42).ok === true and .value === 42", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    } else {
      throw new Error("Should have been ok");
    }
  });

  it("AC-CORE-006.02: err({code:'DOC_NOT_FOUND',...}).ok === false", () => {
    const error: LoreError = {
      code: "DOC_NOT_FOUND",
      id: "some-id",
    };
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    } else {
      throw new Error("Should have been err");
    }
  });

  it("AC-CORE-006.03: Result<T, E> generic type works", () => {
    const r1: Result<number> = ok(1);
    const r2: Result<string, LoreError> = err({
      code: "PARENT_REQUIRED",
      type: "spec",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
  });
});
