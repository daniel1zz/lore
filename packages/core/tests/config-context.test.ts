/**
 * Tests for @lore/core config — `context.memory_files.*` section only
 * (spec-project-claude-md-content-contract-governance-injected §D1/D8). Pure
 * schema + resolver, no IO. Scoped deliberately: mirrors
 * `config-staleness.test.ts`/`config-drift.test.ts`'s scoping precedent —
 * this file does not duplicate other top-level sections' coverage.
 *
 * RED phase (TDD-Role: red; paired impl: task-skill-implement-contextconfigschema):
 * `contextConfigSchema` and `resolveMemoryFileBudgets` do not exist yet in
 * packages/core/src/config.ts. Every case below is expected to fail — at
 * import/parse time, not on assertion logic — until the paired implementation
 * task lands them.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      resolveMemoryFileBudgets(undefined), and of a LoreConfig with
 *               no `context` key, both return the documented defaults (root
 *               {max_lines:300,max_bytes:30720}, module
 *               {max_lines:200,max_bytes:16384}, enabled:true,
 *               filenames:["CLAUDE.md"]); an explicit full override round-trips
 *   NEGATIVE:   an unknown key under `context.memory_files` (the camelCase
 *               typo `rootMaxLines`) is rejected via `.strict()`; same for an
 *               unknown sibling key directly under `context`. Both are
 *               asserted against `contextConfigSchema` directly (NOT routed
 *               through `LoreConfigSchema`) — `LoreConfigSchema` is already
 *               `.strict()` today and rejects ANY payload containing a
 *               `context` key outright (it isn't a recognized top-level key
 *               yet), which would make a `LoreConfigSchema`-level rejection
 *               assertion vacuously true both before and after this feature
 *               lands and therefore prove nothing
 *   BOUNDARY:   a partial override (root.max_lines only, or module.max_bytes
 *               only) merges at the field level — every untouched sibling
 *               field/block keeps its schema default
 *   ERROR:      n/a at this layer (pure schema + resolver, no Result channel)
 *   STATE:      `enabled: false` propagates in isolation — no other field
 *               (root/module/filenames) mutates as a side effect of setting it
 *   REGRESSION: a LoreConfig with no `context` key at all still parses
 *               (back-compat) and an existing `workflow` section's own
 *               resolution is unaffected by `context` being present alongside it
 *
 * @spec_ref spec-project-claude-md-content-contract-governance-injected §D1/D8; task-skill-implement-contextconfigschema
 */

import { describe, it, expect } from "vitest";
import { LoreConfigSchema, contextConfigSchema, resolveMemoryFileBudgets } from "./../src/config.js";

const MINIMAL_PROJECT = { name: "test-project", author: "alice" };

const DEFAULT_BUDGETS = {
  enabled: true,
  filenames: ["CLAUDE.md"],
  root: { max_lines: 300, max_bytes: 30720 },
  module: { max_lines: 200, max_bytes: 16384 },
  // SPEC-146 N7: a third, separate ceiling pair for `.claude/rules/**/*.md`
  // path-scoped rule files — never a reuse of `module`'s (packages/core/src/
  // config.ts, contextConfigSchema.memory_files.rules doc comment).
  rules: { max_lines: 100, max_bytes: 8192 },
  warn_threshold_fraction: 0.9,
  // task-a-module-claude-md-at-its-byte-ceiling-silently-relocates: the third
  // band. Advisory (0.9) < deterministic eviction floor (0.97) <= ceiling.
  evict_threshold_fraction: 0.97,
  // SPEC-146 Phase 2 N5/N6: a separate, single-threshold block for marker
  // density (⛔/IMPORTANT/MUST/NEVER per KB) — deliberately NOT part of the
  // warn/evict band machinery above (config.ts, `emphasis` doc comment).
  emphasis: { max_per_kb: 3 },
};

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("resolveMemoryFileBudgets — HAPPY", () => {
  it("undefined config falls back to the documented defaults", () => {
    expect(resolveMemoryFileBudgets(undefined)).toEqual(DEFAULT_BUDGETS);
  });

  it("Given no `context` section, When resolveMemoryFileBudgets(config), Then result deep-equals documented defaults", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT });
    expect(resolveMemoryFileBudgets(parsed)).toEqual(DEFAULT_BUDGETS);
  });

  it("an explicit full override round-trips", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      context: {
        memory_files: {
          enabled: false,
          filenames: ["CLAUDE.md", "AGENTS.md"],
          root: { max_lines: 500, max_bytes: 51200 },
          module: { max_lines: 250, max_bytes: 20480 },
          rules: { max_lines: 150, max_bytes: 12288 },
          warn_threshold_fraction: 0.75,
          evict_threshold_fraction: 0.88,
          emphasis: { max_per_kb: 5 },
        },
      },
    });
    expect(resolveMemoryFileBudgets(parsed)).toEqual({
      enabled: false,
      filenames: ["CLAUDE.md", "AGENTS.md"],
      root: { max_lines: 500, max_bytes: 51200 },
      module: { max_lines: 250, max_bytes: 20480 },
      rules: { max_lines: 150, max_bytes: 12288 },
      warn_threshold_fraction: 0.75,
      evict_threshold_fraction: 0.88,
      emphasis: { max_per_kb: 5 },
    });
  });
});

// ─── warn_threshold_fraction (task-lore-status-check-claude-md-reports-a-saturated-file-as) ──

describe("resolveMemoryFileBudgets — warn_threshold_fraction", () => {
  it("HAPPY: defaults to 0.9 when unset", () => {
    const resolved = resolveMemoryFileBudgets(undefined);
    expect(resolved.warn_threshold_fraction).toBe(0.9);
  });

  it("BOUNDARY: 0 is accepted; the upper bound is now the eviction floor, not 1", () => {
    const lowParsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      context: { memory_files: { warn_threshold_fraction: 0 } },
    });
    expect(resolveMemoryFileBudgets(lowParsed).warn_threshold_fraction).toBe(0);

    // task-a-module-claude-md-at-its-byte-ceiling-silently-relocates: `1` was
    // accepted while `warn` was the only fraction. It is now refused, because
    // the band-ordering invariant requires `warn < evict <= 1` — a `warn` of 1
    // would sit ABOVE the deterministic eviction floor, making the advisory
    // band unreachable and letting a file jump from silent straight to a block.
    // (A `warn` of 1 was already a useless setting: it warns only at 100% used,
    // which is precisely the no-runway-signal state the field was added to fix.)
    const atOne = contextConfigSchema.safeParse({ memory_files: { warn_threshold_fraction: 1 } });
    expect(atOne.success).toBe(false);

    // Positive control: the real upper bound is "strictly below evict", so a
    // high `warn` IS accepted when the floor is raised to match.
    const highPaired = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      context: { memory_files: { warn_threshold_fraction: 0.99, evict_threshold_fraction: 1 } },
    });
    expect(resolveMemoryFileBudgets(highPaired).warn_threshold_fraction).toBe(0.99);
  });

  it("NEGATIVE: a value outside [0, 1] is rejected by contextConfigSchema", () => {
    const tooHigh = contextConfigSchema.safeParse({ memory_files: { warn_threshold_fraction: 1.5 } });
    expect(tooHigh.success).toBe(false);

    const tooLow = contextConfigSchema.safeParse({ memory_files: { warn_threshold_fraction: -0.1 } });
    expect(tooLow.success).toBe(false);
  });

  it("STATE: a custom fraction does not disturb sibling ceiling fields", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      context: { memory_files: { warn_threshold_fraction: 0.5 } },
    });
    const resolved = resolveMemoryFileBudgets(parsed);
    expect(resolved.warn_threshold_fraction).toBe(0.5);
    expect(resolved.root).toEqual({ max_lines: 300, max_bytes: 30720 });
    expect(resolved.module).toEqual({ max_lines: 200, max_bytes: 16384 });
  });
});

// ─── BOUNDARY (field-level merge) ──────────────────────────────────────────

describe("resolveMemoryFileBudgets — BOUNDARY (partial override)", () => {
  it("Given partial override (root.max_lines only), When resolved, Then merge is field-level, siblings keep defaults", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      context: { memory_files: { root: { max_lines: 450 } } },
    });
    const resolved = resolveMemoryFileBudgets(parsed);
    expect(resolved.root.max_lines).toBe(450);
    expect(resolved.root.max_bytes).toBe(30720); // sibling field default preserved
    expect(resolved.module).toEqual({ max_lines: 200, max_bytes: 16384 }); // untouched sibling block
    expect(resolved.enabled).toBe(true);
    expect(resolved.filenames).toEqual(["CLAUDE.md"]);
  });

  it("a partial override of module.max_bytes only leaves root and the rest of module untouched", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      context: { memory_files: { module: { max_bytes: 8192 } } },
    });
    const resolved = resolveMemoryFileBudgets(parsed);
    expect(resolved.module).toEqual({ max_lines: 200, max_bytes: 8192 });
    expect(resolved.root).toEqual({ max_lines: 300, max_bytes: 30720 });
  });
});

// ─── STATE (field isolation) ───────────────────────────────────────────────

describe("resolveMemoryFileBudgets — STATE (enabled propagates in isolation)", () => {
  it("Given `enabled: false`, When resolved, Then enabled false propagates and no other field mutates", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      context: { memory_files: { enabled: false } },
    });
    const resolved = resolveMemoryFileBudgets(parsed);
    expect(resolved.enabled).toBe(false);
    expect(resolved.root).toEqual({ max_lines: 300, max_bytes: 30720 });
    expect(resolved.module).toEqual({ max_lines: 200, max_bytes: 16384 });
    expect(resolved.filenames).toEqual(["CLAUDE.md"]);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("contextConfigSchema — NEGATIVE", () => {
  it("Given unknown key `context.memory_files.rootMaxLines`, When schema parses, Then ZodError (strict)", () => {
    const result = contextConfigSchema.safeParse({ memory_files: { rootMaxLines: 300 } });
    expect(result.success).toBe(false);
  });

  it("an unknown sibling key directly under `context` (alongside `memory_files`) is rejected", () => {
    const result = contextConfigSchema.safeParse({ memory_files: {}, bogus_sibling: true });
    expect(result.success).toBe(false);
  });

  it("a well-formed payload (no typos) is accepted by contextConfigSchema — the negative cases above fail on the specific unknown key, not on any use of the schema", () => {
    const result = contextConfigSchema.safeParse({ memory_files: { root: { max_lines: 450 } } });
    expect(result.success).toBe(true);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — absent `context` section still parses and other sections are unaffected", () => {
  it("a LoreConfig with no `context` key at all still parses (back-compat)", () => {
    const parsed = LoreConfigSchema.parse({ project: MINIMAL_PROJECT });
    expect(parsed.context).toBeUndefined();
    expect(resolveMemoryFileBudgets(parsed)).toEqual(DEFAULT_BUDGETS);
  });

  it("presence of `context` does not disturb an existing `workflow` section's own resolution", () => {
    const parsed = LoreConfigSchema.parse({
      project: MINIMAL_PROJECT,
      workflow: { claim_ttl_minutes: 60 },
      context: { memory_files: { enabled: false } },
    });
    expect(parsed.workflow?.claim_ttl_minutes).toBe(60);
    expect(resolveMemoryFileBudgets(parsed).enabled).toBe(false);
  });
});
