/**
 * Tests for @lore/core config — verify.* section only (SPEC-039 §2 D9).
 * Pure schema + resolver, no IO. Scoped deliberately: full LoreConfigSchema
 * coverage lives at packages/lore/tests/unit/core/config.test.ts — this file
 * does not duplicate that, only the new `verify` section it doesn't cover.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      resolveVerifyDefaultTimeoutMs falls back to 300000 when config/section
 *               absent; returns the configured value when present; a minimal valid
 *               LoreConfig with a verify section parses
 *   NEGATIVE:   an unknown key inside verify: {} is rejected (.strict())
 *   BOUNDARY:   default_timeout_ms of 0 / negative / non-integer rejected
 *   ERROR:      n/a at this layer (pure schema + resolver, no Result channel on
 *               the resolver; schema violations are covered under NEGATIVE/BOUNDARY)
 *   STATE:      n/a (no accumulation across calls — resolver is a pure projection)
 *   REGRESSION: a LoreConfig with no verify key at all still parses (back-compat)
 *               and the resolver falls back to the default
 *
 * @spec_ref SPEC-039 §2 D9
 */

import { describe, it, expect } from "vitest";
import { resolveVerifyDefaultTimeoutMs, LoreConfigSchema } from "./config.js";

const MINIMAL_PROJECT = { name: "test-project", author: "alice" };

describe("resolveVerifyDefaultTimeoutMs", () => {
  it("HAPPY: undefined config falls back to 300000", () => {
    expect(resolveVerifyDefaultTimeoutMs(undefined)).toBe(300_000);
  });

  it("HAPPY: a LoreConfig with verify.default_timeout_ms set returns that value", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: 60_000 },
    });
    expect(resolveVerifyDefaultTimeoutMs(parsed)).toBe(60_000);
  });

  it("REGRESSION: a LoreConfig with NO verify key still parses and resolver falls back to the default", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT });
    expect(parsed.verify).toBeUndefined();
    expect(resolveVerifyDefaultTimeoutMs(parsed)).toBe(300_000);
  });
});

describe("LoreConfigSchema.verify", () => {
  it("HAPPY: a minimal valid project + verify block parses successfully", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: 60_000 },
    });
    expect(result.success).toBe(true);
  });

  it("BOUNDARY: default_timeout_ms of 0 is rejected (must be positive)", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: a negative default_timeout_ms is rejected", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: a non-integer default_timeout_ms (1.5) is rejected", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: an unknown key inside verify: {} is rejected (.strict())", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: 60_000, unknown_key: "oops" },
    });
    expect(result.success).toBe(false);
  });
});
