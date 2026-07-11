/**
 * Tests for @lore/core validity.ts — bi-temporal validity metadata pure layer
 * (SPEC-043 §Design Decisions D1). Pure, no IO. Dedicated `tests/` path (not
 * colocated `src/`), mirroring file-anchors.test.ts's SPEC-042 precedent.
 *
 * Six-dimension coverage:
 *   HAPPY:      absent validity → valid; effectiveValidAt falls back to created_at;
 *               equality boundary accepted; renderValidityBanner format variants
 *   NEGATIVE:   invalid_at < valid_at rejected; reason >500 rejected
 *   BOUNDARY:   invalid_at === valid_at accepted (equality legal); isInvalidated
 *               flips exactly at the injected nowIso instant
 *   ERROR:      n/a — this layer is pure/no IO; validitySchema.safeParse never throws
 *   STATE:      n/a — every function here is stateless/pure
 *   REGRESSION: isInvalidated accepts BOTH a DocRecord-shaped (`extra`) input and a
 *               SearchHit-shaped (`validity`) input identically; validityEqual
 *               round-trips
 *
 * @spec_ref SPEC-043 AC-MH-1
 */

import { describe, it, expect } from "vitest";
import {
  validitySchema,
  extractValidity,
  effectiveValidAt,
  isInvalidated,
  validityEqual,
  renderValidityBanner,
} from "../src/validity.js";
import type { DocRecord } from "../src/types.js";

function makeDoc(extra: Record<string, unknown>, createdAt = "2026-01-01T00:00:00.000Z"): Pick<DocRecord, "extra" | "created_at"> {
  return { extra, created_at: createdAt };
}

// ─── validitySchema ─────────────────────────────────────────────────────────

describe("HAPPY — validitySchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(validitySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a fully-populated valid object", () => {
    const result = validitySchema.safeParse({
      valid_at: "2026-01-01T00:00:00.000Z",
      invalid_at: "2026-06-01T00:00:00.000Z",
      invalidated_by: "01HTESTDOCID00000000000001",
      reason: "superseded",
    });
    expect(result.success).toBe(true);
  });
});

describe("BOUNDARY — validitySchema ordering, equality accepted", () => {
  it("invalid_at === valid_at is accepted (equality legal)", () => {
    const result = validitySchema.safeParse({
      valid_at: "2026-01-01T00:00:00.000Z",
      invalid_at: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("NEGATIVE — validitySchema ordering + reason cap", () => {
  it("invalid_at < valid_at is rejected", () => {
    const result = validitySchema.safeParse({
      valid_at: "2026-06-01T00:00:00.000Z",
      invalid_at: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["invalid_at"]);
  });

  it("reason longer than 500 chars is rejected", () => {
    const result = validitySchema.safeParse({ reason: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("reason of exactly 500 chars is accepted (boundary)", () => {
    const result = validitySchema.safeParse({ reason: "x".repeat(500) });
    expect(result.success).toBe(true);
  });

  it("does NOT enforce a future-date check (that's the service's job, D1 split)", () => {
    // A far-future invalid_at with no valid_at is schema-legal — core stays
    // wall-clock free. ValidityService rejects this at the service seam.
    const result = validitySchema.safeParse({ invalid_at: "2099-01-01T00:00:00.000Z" });
    expect(result.success).toBe(true);
  });
});

// ─── extractValidity / effectiveValidAt ────────────────────────────────────

describe("HAPPY — extractValidity / effectiveValidAt", () => {
  it("absent extra.validity → extractValidity undefined, effectiveValidAt falls back to created_at", () => {
    const doc = makeDoc({}, "2026-02-01T00:00:00.000Z");
    expect(extractValidity(doc)).toBeUndefined();
    expect(effectiveValidAt(doc)).toBe("2026-02-01T00:00:00.000Z");
  });

  it("present valid_at wins over created_at", () => {
    const doc = makeDoc(
      { validity: { valid_at: "2026-03-01T00:00:00.000Z" } },
      "2026-02-01T00:00:00.000Z",
    );
    expect(effectiveValidAt(doc)).toBe("2026-03-01T00:00:00.000Z");
  });

  it("extractValidity degrades to undefined on a malformed extra.validity (defensive)", () => {
    const doc = makeDoc({ validity: { invalid_at: "not-even-a-string-issue", valid_at: 12345 } });
    // valid_at: number fails the z.string() field type — malformed input degrades to undefined.
    expect(extractValidity(doc)).toBeUndefined();
  });

  it("extractValidity degrades to undefined on a corrupted non-object extra (defensive)", () => {
    const doc = { extra: null as unknown as Record<string, unknown>, created_at: "2026-01-01T00:00:00.000Z" };
    expect(extractValidity(doc)).toBeUndefined();
    expect(effectiveValidAt(doc)).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ─── isInvalidated ──────────────────────────────────────────────────────────

describe("HAPPY — isInvalidated", () => {
  it("absent validity → never invalidated", () => {
    expect(isInvalidated(makeDoc({}), "2026-06-01T00:00:00.000Z")).toBe(false);
  });

  it("invalid_at in the past → invalidated", () => {
    const doc = makeDoc({ validity: { invalid_at: "2026-01-01T00:00:00.000Z" } });
    expect(isInvalidated(doc, "2026-06-01T00:00:00.000Z")).toBe(true);
  });

  it("invalid_at in the future → not yet invalidated", () => {
    const doc = makeDoc({ validity: { invalid_at: "2026-12-01T00:00:00.000Z" } });
    expect(isInvalidated(doc, "2026-06-01T00:00:00.000Z")).toBe(false);
  });

  it("a future valid_at alone does NOT exclude a doc (only invalid_at filters)", () => {
    const doc = makeDoc({ validity: { valid_at: "2099-01-01T00:00:00.000Z" } });
    expect(isInvalidated(doc, "2026-06-01T00:00:00.000Z")).toBe(false);
  });
});

describe("BOUNDARY — isInvalidated flips exactly at the injected nowIso instant", () => {
  it("nowIso === invalid_at → invalidated (inclusive boundary)", () => {
    const doc = makeDoc({ validity: { invalid_at: "2026-06-01T00:00:00.000Z" } });
    expect(isInvalidated(doc, "2026-06-01T00:00:00.000Z")).toBe(true);
  });

  it("nowIso one millisecond before invalid_at → not yet invalidated", () => {
    const doc = makeDoc({ validity: { invalid_at: "2026-06-01T00:00:00.001Z" } });
    expect(isInvalidated(doc, "2026-06-01T00:00:00.000Z")).toBe(false);
  });

  it("nowIso one millisecond after invalid_at → invalidated", () => {
    const doc = makeDoc({ validity: { invalid_at: "2026-06-01T00:00:00.000Z" } });
    expect(isInvalidated(doc, "2026-06-01T00:00:00.001Z")).toBe(true);
  });
});

describe("REGRESSION — isInvalidated accepts a SearchHit-shaped (validity, no extra) input identically", () => {
  it("DocRecord-shaped and SearchHit-shaped inputs with the same validity agree", () => {
    const nowIso = "2026-06-01T00:00:00.000Z";
    const validity = { invalid_at: "2026-01-01T00:00:00.000Z" };
    const docShaped = isInvalidated({ extra: { validity } }, nowIso);
    const hitShaped = isInvalidated({ validity }, nowIso);
    expect(docShaped).toBe(true);
    expect(hitShaped).toBe(true);
  });

  it("a SearchHit-shaped input with no validity field is never invalidated", () => {
    expect(isInvalidated({}, "2026-06-01T00:00:00.000Z")).toBe(false);
  });
});

// ─── validityEqual ──────────────────────────────────────────────────────────

describe("HAPPY / REGRESSION — validityEqual", () => {
  it("two undefined values are equal", () => {
    expect(validityEqual(undefined, undefined)).toBe(true);
  });

  it("undefined vs a populated value are not equal", () => {
    expect(validityEqual(undefined, { invalid_at: "2026-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("identical field-by-field values are equal, even as distinct object instances", () => {
    const a = { valid_at: "2026-01-01T00:00:00.000Z", invalid_at: "2026-02-01T00:00:00.000Z", reason: "x" };
    const b = { valid_at: "2026-01-01T00:00:00.000Z", invalid_at: "2026-02-01T00:00:00.000Z", reason: "x" };
    expect(validityEqual(a, b)).toBe(true);
  });

  it("a changed reason makes two validity objects unequal", () => {
    const a = { invalid_at: "2026-01-01T00:00:00.000Z", reason: "x" };
    const b = { invalid_at: "2026-01-01T00:00:00.000Z", reason: "y" };
    expect(validityEqual(a, b)).toBe(false);
  });
});

// ─── renderValidityBanner ───────────────────────────────────────────────────

describe("HAPPY — renderValidityBanner format variants (D4)", () => {
  it("invalid_at only — no dangling separators", () => {
    expect(renderValidityBanner({ invalid_at: "2026-07-01T00:00:00.000Z" })).toBe(
      "> ⚠ INVALIDATED 2026-07-01T00:00:00.000Z",
    );
  });

  it("invalid_at + successor_slug", () => {
    expect(
      renderValidityBanner({ invalid_at: "2026-07-01T00:00:00.000Z", successor_slug: "knowledge-new" }),
    ).toBe("> ⚠ INVALIDATED 2026-07-01T00:00:00.000Z — superseded by knowledge-new");
  });

  it("invalid_at + successor_slug + successor_deleted appends the (deleted) suffix", () => {
    expect(
      renderValidityBanner({
        invalid_at: "2026-07-01T00:00:00.000Z",
        successor_slug: "knowledge-new",
        successor_deleted: true,
      }),
    ).toBe("> ⚠ INVALIDATED 2026-07-01T00:00:00.000Z — superseded by knowledge-new (deleted)");
  });

  it("invalid_at + reason only (no successor)", () => {
    expect(
      renderValidityBanner({ invalid_at: "2026-07-01T00:00:00.000Z", reason: "obsolete" }),
    ).toBe("> ⚠ INVALIDATED 2026-07-01T00:00:00.000Z; obsolete");
  });

  it("all fields present render in the pinned order with no dangling separators", () => {
    expect(
      renderValidityBanner({
        invalid_at: "2026-07-01T00:00:00.000Z",
        successor_slug: "knowledge-new",
        reason: "obsolete",
      }),
    ).toBe("> ⚠ INVALIDATED 2026-07-01T00:00:00.000Z — superseded by knowledge-new; obsolete");
  });
});
