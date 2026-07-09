/**
 * Tests for @lore/core config — `workflow.gates.*` section only (SPEC-0XX, `lore gate`
 * per-checkpoint enable/disable overrides). Pure schema + resolver, no IO. Scoped
 * deliberately, mirroring `config.test.ts`'s (verify-only) precedent: full
 * `LoreConfigSchema` coverage lives at `packages/lore/tests/unit/core/config.test.ts` —
 * this file does not duplicate that, only the new `workflow.gates` field it doesn't cover.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      resolveGateEnabled defaults to true when config/workflow/gates/entry is
 *               absent; returns false only for an explicit `enabled: false`; a minimal
 *               valid LoreConfig with a workflow.gates section parses
 *   NEGATIVE:   an unknown key inside a `gates.<checkpoint>: {}` entry is rejected
 *               (.strict() on GateCheckpointConfigSchema)
 *   BOUNDARY:   `enabled` set to a non-boolean value is rejected by Zod
 *   ERROR:      n/a at this layer (pure schema + resolver, no Result channel on the
 *               resolver; schema violations covered under NEGATIVE/BOUNDARY)
 *   STATE:      n/a (resolver is a pure projection, no accumulation across calls)
 *   REGRESSION: a LoreConfig with no `workflow` key at all (or `workflow` present but no
 *               `gates` key) still parses and every checkpoint resolves enabled — keeps
 *               pre-existing `.lore/config.yaml` files gating exactly as before this field
 *               existed
 *
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11 — per-checkpoint gate config
 */

import { describe, it, expect } from "vitest";
import { resolveGateEnabled, LoreConfigSchema } from "./config.js";

const MINIMAL_PROJECT = { name: "test-project", author: "alice" };

describe("resolveGateEnabled", () => {
  it("HAPPY: undefined config resolves every checkpoint as enabled", () => {
    expect(resolveGateEnabled(undefined, "task-claim")).toBe(true);
    expect(resolveGateEnabled(undefined, "plan-promote")).toBe(true);
  });

  it("REGRESSION: a LoreConfig with no workflow key at all resolves enabled", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT });
    expect(parsed.workflow).toBeUndefined();
    expect(resolveGateEnabled(parsed, "task-claim")).toBe(true);
  });

  it("REGRESSION: workflow present but no gates key resolves enabled", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { claim_ttl_minutes: 30 },
    });
    expect(parsed.workflow?.gates).toBeUndefined();
    expect(resolveGateEnabled(parsed, "task-claim")).toBe(true);
  });

  it("HAPPY: a gates entry present but without this checkpoint's key resolves enabled", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { gates: { "spec-create": { enabled: false } } },
    });
    expect(resolveGateEnabled(parsed, "task-claim")).toBe(true);
  });

  it("HAPPY: an explicit enabled: true resolves enabled", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { gates: { "task-claim": { enabled: true } } },
    });
    expect(resolveGateEnabled(parsed, "task-claim")).toBe(true);
  });

  it("HAPPY: an explicit enabled: false resolves disabled — only this checkpoint", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: {
        gates: { "task-claim": { enabled: false } },
      },
    });
    expect(resolveGateEnabled(parsed, "task-claim")).toBe(false);
    expect(resolveGateEnabled(parsed, "plan-promote")).toBe(true);
  });
});

describe("LoreConfigSchema.workflow.gates", () => {
  it("HAPPY: a minimal valid project + workflow.gates block parses successfully", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { gates: { "task-claim": { enabled: false } } },
    });
    expect(result.success).toBe(true);
  });

  it("HAPPY: an empty gates map parses successfully", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { gates: {} },
    });
    expect(result.success).toBe(true);
  });

  it("BOUNDARY: enabled set to a non-boolean value is rejected", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { gates: { "task-claim": { enabled: "false" } } },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: enabled set to null is rejected", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { gates: { "task-claim": { enabled: null } } },
    });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: an unknown key inside a gates.<checkpoint> entry is rejected (.strict())", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { gates: { "task-claim": { enabled: false, extra_typo: true } } },
    });
    expect(result.success).toBe(false);
  });
});
