/**
 * Tests for @lore/core config — `workflow.drift.*` section only (SPEC-045
 * §Design Decisions D8). Pure schema + resolver, no IO. Scoped deliberately:
 * mirrors `config-staleness.test.ts`'s scoping precedent — this file does not
 * duplicate other `workflow.*` sub-section coverage.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      workflow.drift.enabled defaults to true when absent; explicit
 *               true/false round-trip; resolveDriftEnabled returns the
 *               configured value
 *   NEGATIVE:   non-boolean `enabled` fails loud; unknown keys under
 *               `workflow.drift` are rejected (.strict())
 *   BOUNDARY:   n/a (boolean field, no numeric range)
 *   ERROR:      n/a at this layer (pure schema + resolver, no Result channel)
 *   STATE:      n/a (resolver is a pure projection, no accumulation across calls)
 *   REGRESSION: a LoreConfig with no workflow.drift key still parses (back-compat)
 *               and resolveDriftEnabled falls back to true
 *
 * @spec_ref SPEC-045 §Design Decisions D8; AC-DR-7
 */

import { describe, it, expect } from "vitest";
import { LoreConfigSchema, resolveDriftEnabled } from "./../src/config.js";

const MINIMAL_PROJECT = { name: "test-project", author: "alice" };

describe("resolveDriftEnabled — HAPPY", () => {
  it("undefined config falls back to true", () => {
    expect(resolveDriftEnabled(undefined)).toBe(true);
  });

  it("workflow.drift.enabled defaults to true when absent", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT, workflow: {} });
    expect(resolveDriftEnabled(parsed)).toBe(true);
  });

  it("explicit workflow.drift.enabled: false round-trips", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { drift: { enabled: false } },
    });
    expect(resolveDriftEnabled(parsed)).toBe(false);
  });

  it("explicit workflow.drift.enabled: true round-trips", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { drift: { enabled: true } },
    });
    expect(resolveDriftEnabled(parsed)).toBe(true);
  });
});

describe("LoreConfigSchema.workflow.drift — NEGATIVE", () => {
  it("non-boolean enabled fails loud", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { drift: { enabled: "yes" } },
    });
    expect(result.success).toBe(false);
  });

  it("an unknown key inside workflow.drift is rejected (.strict())", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { drift: { enabled: true, bogus_key: "oops" } },
    });
    expect(result.success).toBe(false);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — absent workflow.drift section still parses and falls back to default", () => {
  it("a LoreConfig with no workflow.drift key still parses", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT });
    expect(parsed.workflow).toBeUndefined();
    expect(resolveDriftEnabled(parsed)).toBe(true);
  });

  it("a LoreConfig with other workflow.* keys but no drift key still resolves the drift default", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { claim_ttl_minutes: 60 },
    });
    expect(resolveDriftEnabled(parsed)).toBe(true);
  });
});
