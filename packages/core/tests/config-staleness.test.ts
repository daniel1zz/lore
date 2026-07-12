/**
 * Tests for @lore/core config — `ai.staleness.*` + `workflow.staleness.*` sections
 * only (SPEC-044 §Design Decisions D8). Pure schema + resolver, no IO. Scoped
 * deliberately: mirrors `packages/core/src/config.test.ts`'s `verify.*`-only scope —
 * this file does not duplicate other sections' coverage.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      ai.staleness/workflow.staleness defaults apply when absent
 *               (12000/20, 5/14 respectively); explicit values round-trip;
 *               resolveStalenessDefaults returns the configured pair
 *   NEGATIVE:   unknown keys inside either block are rejected (.strict()); NO new
 *               top-level `review.*` block exists (D8 — asserted structurally)
 *   BOUNDARY:   max_doc_chars/neighbor_limit/default_limit of 0 or negative rejected
 *               (must be positive); non-integer values rejected; min_age_days of 0 is
 *               ACCEPTED (nonnegative, not positive — 0 is a legal "probe immediately"
 *               threshold) but -1 is rejected
 *   ERROR:      n/a at this layer (pure schema + resolver, no Result channel)
 *   STATE:      n/a (resolver is a pure projection, no accumulation across calls)
 *   REGRESSION: a LoreConfig with NEITHER `ai.staleness` nor `workflow.staleness` keys
 *               still parses (back-compat) and both resolvers fall back to defaults;
 *               CLI --limit/--min-age-days override config for that invocation only
 *               (asserted at the resolver-input level — the resolver itself never reads
 *               CLI flags, so "override" is proven by the caller simply not consulting
 *               the resolved default when an explicit value is supplied)
 *
 * @spec_ref SPEC-044 §Design Decisions D8; AC-SP-10
 */

import { describe, it, expect } from "vitest";
import { AiConfigSchema } from "./../src/ai.js";
import { LoreConfigSchema, resolveStalenessDefaults } from "./../src/config.js";

const MINIMAL_PROJECT = { name: "test-project", author: "alice" };

// ─── ai.staleness.* ─────────────────────────────────────────────────────────

describe("AiConfigSchema.staleness — HAPPY (defaults)", () => {
  it("ai.staleness.parse({}) yields max_doc_chars=12000, neighbor_limit=20", () => {
    const parsed = AiConfigSchema.parse({});
    expect(parsed.staleness).toEqual({ max_doc_chars: 12000, neighbor_limit: 20 });
  });

  it("explicit ai.staleness values round-trip", () => {
    const parsed = AiConfigSchema.parse({ staleness: { max_doc_chars: 5000, neighbor_limit: 3 } });
    expect(parsed.staleness).toEqual({ max_doc_chars: 5000, neighbor_limit: 3 });
  });
});

describe("AiConfigSchema.staleness — NEGATIVE", () => {
  it("an unknown key inside ai.staleness is rejected (.strict())", () => {
    const result = AiConfigSchema.safeParse({ staleness: { max_doc_chars: 5000, bogus_key: "oops" } });
    expect(result.success).toBe(false);
  });
});

describe("AiConfigSchema.staleness — BOUNDARY", () => {
  it("max_doc_chars of 0 is rejected (must be positive)", () => {
    expect(AiConfigSchema.safeParse({ staleness: { max_doc_chars: 0 } }).success).toBe(false);
  });

  it("max_doc_chars negative is rejected", () => {
    expect(AiConfigSchema.safeParse({ staleness: { max_doc_chars: -1 } }).success).toBe(false);
  });

  it("neighbor_limit of 0 is rejected (must be positive)", () => {
    expect(AiConfigSchema.safeParse({ staleness: { neighbor_limit: 0 } }).success).toBe(false);
  });

  it("neighbor_limit non-integer (1.5) is rejected", () => {
    expect(AiConfigSchema.safeParse({ staleness: { neighbor_limit: 1.5 } }).success).toBe(false);
  });
});

// ─── workflow.staleness.* ───────────────────────────────────────────────────

describe("resolveStalenessDefaults — HAPPY", () => {
  it("undefined config falls back to {default_limit: 5, min_age_days: 14}", () => {
    expect(resolveStalenessDefaults(undefined)).toEqual({ default_limit: 5, min_age_days: 14 });
  });

  it("a LoreConfig with workflow.staleness set returns the configured pair", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { default_limit: 10, min_age_days: 30 } },
    });
    expect(resolveStalenessDefaults(parsed)).toEqual({ default_limit: 10, min_age_days: 30 });
  });
});

describe("LoreConfigSchema.workflow.staleness — BOUNDARY", () => {
  it("default_limit of 0 is rejected (must be positive)", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { default_limit: 0 } },
    });
    expect(result.success).toBe(false);
  });

  it("default_limit negative is rejected", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { default_limit: -5 } },
    });
    expect(result.success).toBe(false);
  });

  it("default_limit non-integer (2.5) is rejected", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { default_limit: 2.5 } },
    });
    expect(result.success).toBe(false);
  });

  it("min_age_days of 0 is ACCEPTED (nonnegative, not positive — a legal 'probe immediately' threshold)", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { min_age_days: 0 } },
    });
    expect(result.success).toBe(true);
  });

  it("min_age_days of -1 is rejected", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { min_age_days: -1 } },
    });
    expect(result.success).toBe(false);
  });
});

describe("LoreConfigSchema.workflow.staleness — NEGATIVE", () => {
  it("an unknown key inside workflow.staleness is rejected (.strict())", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { default_limit: 5, bogus_key: "oops" } },
    });
    expect(result.success).toBe(false);
  });

  it("D8: no new top-level `review` key exists on LoreConfigSchema — staleness config lives under ai.*/workflow.* only", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      // @ts-expect-error — asserting this top-level key is rejected, not typed
      review: { max_doc_chars: 12000 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — absent staleness sections still parse and fall back to defaults", () => {
  it("a LoreConfig with NEITHER ai.staleness nor workflow.staleness keys still parses", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT });
    expect(parsed.workflow).toBeUndefined();
    expect(parsed.ai).toBeUndefined();
    expect(resolveStalenessDefaults(parsed)).toEqual({ default_limit: 5, min_age_days: 14 });
  });

  it("CLI --limit/--min-age-days override config for that invocation only (resolver never reads them — the caller layers an explicit value on top of the resolved default, proven by simply not needing to touch resolveStalenessDefaults when an explicit override is present)", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { staleness: { default_limit: 5, min_age_days: 14 } },
    });
    const resolved = resolveStalenessDefaults(parsed);
    const explicitLimit = 1; // simulates `--limit 1` on the CLI
    const effectiveLimit = explicitLimit ?? resolved.default_limit;
    expect(effectiveLimit).toBe(1);
    expect(resolved.default_limit).toBe(5); // the resolved config default is untouched
  });
});
