/**
 * Tests for @lore/core config — verify.* section only (SPEC-039 §2 D9; §M2
 * trust-hardening: verify.env.* + verify.require_command_approval).
 * Pure schema + resolver, no IO. Scoped deliberately: full LoreConfigSchema
 * coverage lives at packages/lore/tests/unit/core/config.test.ts — this file
 * does not duplicate that, only the new `verify` section it doesn't cover.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      resolveVerifyDefaultTimeoutMs falls back to 300000 when config/section
 *               absent; returns the configured value when present; a minimal valid
 *               LoreConfig with a verify section parses; resolveVerifyEnvConfig /
 *               resolveVerifyRequireCommandApproval return their configured values
 *   NEGATIVE:   an unknown key inside verify: {} (or verify.env: {}) is rejected (.strict())
 *   BOUNDARY:   default_timeout_ms of 0 / negative / non-integer rejected
 *   ERROR:      n/a at this layer (pure schema + resolver, no Result channel on
 *               the resolver; schema violations are covered under NEGATIVE/BOUNDARY)
 *   STATE:      n/a (no accumulation across calls — resolver is a pure projection)
 *   REGRESSION: a LoreConfig with no verify key at all still parses (back-compat)
 *               and the resolver falls back to the default (allowlist: [],
 *               passthrough_all: false, require_command_approval: true — the
 *               HARDENED default, SPEC-039 §M2: an absent verify section means
 *               the gate is ON, not off)
 *
 * @spec_ref SPEC-039 §2 D9; §M2
 */

import { describe, it, expect } from "vitest";
import {
  resolveVerifyDefaultTimeoutMs,
  resolveVerifyEnvConfig,
  resolveVerifyRequireCommandApproval,
  resolveCaptureTimeoutMs,
  LoreConfigSchema,
} from "./config.js";

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

// ─── SPEC-039 §M2: verify.env.* + verify.require_command_approval ──────────

describe("resolveVerifyEnvConfig — HAPPY/REGRESSION", () => {
  it("REGRESSION: undefined config falls back to the hardened default {allowlist: [], passthrough_all: false}", () => {
    expect(resolveVerifyEnvConfig(undefined)).toEqual({ allowlist: [], passthrough_all: false });
  });

  it("REGRESSION: a LoreConfig with a verify section but no env subsection still falls back to the hardened default", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: 60_000 },
    });
    expect(resolveVerifyEnvConfig(parsed)).toEqual({ allowlist: [], passthrough_all: false });
  });

  it("HAPPY: an explicit allowlist and passthrough_all: true both round-trip", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      verify: { env: { allowlist: ["CI_TOKEN"], passthrough_all: true } },
    });
    expect(resolveVerifyEnvConfig(parsed)).toEqual({ allowlist: ["CI_TOKEN"], passthrough_all: true });
  });
});

describe("LoreConfigSchema.verify.env — NEGATIVE", () => {
  it("an unknown key inside verify.env: {} is rejected (.strict())", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      verify: { env: { allowlist: [], unknown_key: "oops" } },
    });
    expect(result.success).toBe(false);
  });
});

describe("resolveVerifyRequireCommandApproval — HAPPY/REGRESSION", () => {
  it("REGRESSION: undefined config falls back to true — the HARDENED default (gate ON by default)", () => {
    expect(resolveVerifyRequireCommandApproval(undefined)).toBe(true);
  });

  it("REGRESSION: a LoreConfig with a verify section but no require_command_approval key falls back to true", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      verify: { default_timeout_ms: 60_000 },
    });
    expect(resolveVerifyRequireCommandApproval(parsed)).toBe(true);
  });

  it("HAPPY/ESCAPE: require_command_approval: false disables the gate", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      verify: { require_command_approval: false },
    });
    expect(resolveVerifyRequireCommandApproval(parsed)).toBe(false);
  });
});

/**
 * `workflow.evidence.capture_timeout_ms` — the `lore evidence --capture` window
 * (task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a).
 *
 * This key exists because the window used to be the module constant
 * `CAPTURE_TIMEOUT_MS` in `packages/lore/src/adapters/evidence-capture.ts`, which
 * fused a hang detector with an honest oracle's runtime. Measured collision: `bun run
 * test:changed <base>` — this repo's own mandated worktree oracle — at ~624s against
 * the 600s constant, making `--capture` (the ONLY producer of a `capture_source:
 * "runner"` row, and the only class `lore done`'s attested-pass floor accepts)
 * unreachable for a legitimately-scoped run. This schema default is now the SOLE
 * place the number lives: `DEFAULT_CAPTURE_TIMEOUT_MS` derives from it via
 * `resolveCaptureTimeoutMs(undefined)` instead of restating `600_000`.
 *
 * Six-dimension coverage for this block:
 *   HAPPY:      absent config/section resolves to the 600000 default; a set value wins
 *   NEGATIVE:   an unknown key inside workflow.evidence is rejected (.strict())
 *   BOUNDARY:   0 / negative / non-integer rejected; 1 accepted (schema bounds the
 *               TYPE, the operator owns the value)
 *   ERROR:      a `workflow` literal that never passed through WorkflowConfigSchema
 *               (so `evidence` is genuinely absent) resolves without throwing
 *   STATE:      n/a — pure projection, no accumulation across calls
 *   REGRESSION: a config with no `workflow` key at all still parses and resolves to
 *               600000, so an upgrading consumer's behavior is unchanged
 */
describe("resolveCaptureTimeoutMs", () => {
  it("HAPPY: undefined config falls back to 600000 — byte-identical to the retired constant", () => {
    expect(resolveCaptureTimeoutMs(undefined)).toBe(600_000);
  });

  it("HAPPY: a LoreConfig with workflow.evidence.capture_timeout_ms set returns that value", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { evidence: { capture_timeout_ms: 1_800_000 } },
    });
    expect(resolveCaptureTimeoutMs(parsed)).toBe(1_800_000);
  });

  it("REGRESSION: a LoreConfig with NO workflow key still parses and resolves to the 600000 default", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT });
    expect(parsed.workflow).toBeUndefined();
    expect(resolveCaptureTimeoutMs(parsed)).toBe(600_000);
  });

  it("REGRESSION: a workflow section carrying only OTHER keys resolves to the default (the .default({}) fill-in)", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { claim_ttl_minutes: 30 },
    });
    expect(resolveCaptureTimeoutMs(parsed)).toBe(600_000);
  });

  it("ERROR: a hand-built workflow literal that never passed through the schema does not throw", () => {
    // reason: internal callers and tests construct `workflow: {...}` directly, so
    // `config.workflow` being present is NOT proof `config.workflow.evidence` is —
    // the same hazard resolveLedgerAutoApprove documents. The ?.-chain must hold.
    const handBuilt = { project: MINIMAL_PROJECT, workflow: { gates: {} } } as unknown as Parameters<
      typeof resolveCaptureTimeoutMs
    >[0];
    expect(() => resolveCaptureTimeoutMs(handBuilt)).not.toThrow();
    expect(resolveCaptureTimeoutMs(handBuilt)).toBe(600_000);
  });
});

describe("LoreConfigSchema.workflow.evidence", () => {
  it("NEGATIVE: an unknown key inside workflow.evidence is rejected by .strict()", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      // note the deliberate typo — a silently-ignored knob is the defect class this guards
      workflow: { evidence: { capture_timeout_ms: 600_000, capture_timout_ms: 1000 } },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: capture_timeout_ms of 0, negative, or non-integer is rejected", () => {
    for (const bad of [0, -1, 1.5]) {
      const result = LoreConfigSchema.safeParse({
        project: MINIMAL_PROJECT,
        workflow: { evidence: { capture_timeout_ms: bad } },
      });
      expect(result.success).toBe(false);
    }
  });

  it("BOUNDARY: capture_timeout_ms of 1 is accepted — the schema bounds the TYPE, the operator owns the value", () => {
    const result = LoreConfigSchema.safeParse({
      project: MINIMAL_PROJECT,
      workflow: { evidence: { capture_timeout_ms: 1 } },
    });
    expect(result.success).toBe(true);
  });
});
