/**
 * Provenance of a resolved `context.memory_files.*` budget set —
 * `@lore/core`'s `resolveMemoryFileBudgetsFromConfigResult` +
 * `formatMemoryFileBudgetSubstitution` (the shared seam introduced by
 * task-lore-status-check-claude-md-silently-runs-on-schema).
 *
 * ─── RED baseline (recorded before the implementation existed) ─────────────
 * Both symbols were absent from `@lore/core`. Under vitest's esbuild
 * transform a missing named export resolves to `undefined`, so every `it`
 * below failed with `TypeError: resolveMemoryFileBudgetsFromConfigResult is
 * not a function` — a uniform, non-assertion RED across the whole file.
 *
 * ─── What this file pins, and why a plain-value return was the defect ──────
 * Before this seam existed, TWO CLI consumers
 * (`adapters/cli/commands/status.ts::resolveClaudeMdBudgets` and
 * `adapters/cli/commands/context.ts::resolveContextMemoryFileBudgets`, byte-
 * for-byte duplicates) ended in `return resolveMemoryFileBudgets(undefined)`
 * — schema defaults, returned as a bare `MemoryFileBudgets`, with no channel
 * on which to say "these are NOT the numbers you configured". `lore status
 * --check-claude-md` then printed per-doc numbers and exited 0/3 against
 * budgets the operator never chose and could not tell had been substituted.
 *
 * The distinction this file exists to hold is the one a boolean
 * `usedDefaults` flag would collapse: THREE separate routes end at the schema
 * defaults, and only ONE of them is a substitution the operator must hear
 * about.
 *   - `no-config`          — no `.lore/config.yaml` at all. Defaults ARE the
 *                            answer. Announcing would train operators to
 *                            ignore the warning.
 *   - `no-context-section` — a config that fails validation SOMEWHERE ELSE
 *                            and never authored a `context:` block. A VALID
 *                            config without `context` resolves to exactly
 *                            these same defaults, so nothing was substituted.
 *   - `substituted-defaults` — a `context:` block WAS authored and its own
 *                            refusal (e.g. the ordered warn/evict pair) was
 *                            swallowed. THIS is the defect; it must speak.
 *
 * MOCK RISK: none — every fixture is real YAML through the real
 * `loadConfigFromString`, so the `LoreError.value` payload under test is the
 * one production actually produces. The single hand-built input is the
 * `STORE_ERROR` pair, whose shape is copied verbatim from `config-node.ts`'s
 * own `catch` (an fs error cannot be produced by a pure function).
 *
 * Coverage dimensions: HAPPY (valid config honoured) / NEGATIVE (unparseable
 * `context` announced, and the swallowed zod refusal relayed) / BOUNDARY (the
 * three routes that legitimately end at defaults, kept apart) / ERROR
 * (missing vs unreadable config file) / STATE (the renderer speaks for
 * exactly one discriminant) / REGRESSION (the salvage path still salvages the
 * operator's exact numbers, and `resolveMemoryFileBudgets` is untouched).
 *
 * @spec_ref spec-project-claude-md-content-contract-governance-injected
 */

import { describe, it, expect } from "vitest";
import {
  contextConfigSchema,
  err,
  formatMemoryFileBudgetSubstitution,
  loadConfigFromString,
  resolveMemoryFileBudgets,
  resolveMemoryFileBudgetsFromConfigResult,
  type LoreConfig,
  type LoreError,
  type MemoryFileBudgetResolution,
  type Result,
} from "@lore/core";

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** The two keys `LoreConfigSchema.project` requires — omit to fail whole-config validation. */
const VALID_PROJECT_YAML = `project:\n  name: fixture\n  author: fixture-author\n`;

/**
 * A `context:` block the operator authored that the schema REFUSES: with
 * `evict_threshold_fraction` left at its `0.97` default, a
 * `warn_threshold_fraction` of `1` inverts the ordered pair. This is the
 * exact config shape that merge `4d68c84a` newly made unparseable — legal
 * before it, impossible after — and therefore the realistic route into the
 * silent substitution.
 */
const INVERTED_THRESHOLD_CONTEXT_YAML =
  `context:\n  memory_files:\n    root:\n      max_bytes: 5000\n    warn_threshold_fraction: 1\n`;

/** A `context:` block that parses cleanly on its own, carrying a non-default ceiling. */
const VALID_STRICT_CONTEXT_YAML = `context:\n  memory_files:\n    root:\n      max_bytes: 5000\n`;

/** The schema defaults, derived from the schema itself — never restated as literals here. */
const SCHEMA_DEFAULT_BUDGETS = contextConfigSchema.parse({}).memory_files;

function parseYaml(yamlText: string): Result<LoreConfig, LoreError> {
  return loadConfigFromString(yamlText);
}

/**
 * The exact `Result` shape `config-node.ts::loadConfig` returns when
 * `readFileSync` throws — `code`-bearing `Error` in `cause`, no `value`.
 */
function fsFailureResult(errnoCode: string, message: string): Result<LoreConfig, LoreError> {
  const cause = Object.assign(new Error(message), { code: errnoCode });
  return err({ code: "STORE_ERROR", message, cause } satisfies LoreError);
}

/** Narrows to the substituted variant so `reason` is readable without a cast. */
function expectSubstituted(
  resolution: MemoryFileBudgetResolution,
): Extract<MemoryFileBudgetResolution, { source: "substituted-defaults" }> {
  expect(resolution.source).toBe("substituted-defaults");
  if (resolution.source !== "substituted-defaults") throw new Error("unreachable — asserted above");
  return resolution;
}

// ─── HAPPY: a valid config is honoured verbatim ────────────────────────────

describe("resolveMemoryFileBudgetsFromConfigResult: valid config (HAPPY)", () => {
  it("reports source 'config' and returns the operator's own ceiling, not the schema default", () => {
    const resolution = resolveMemoryFileBudgetsFromConfigResult(
      parseYaml(VALID_PROJECT_YAML + VALID_STRICT_CONTEXT_YAML),
    );

    expect(resolution.source).toBe("config");
    // The operator's number, and demonstrably NOT the default it replaced.
    expect(resolution.budgets.root.max_bytes).toBe(5000);
    expect(SCHEMA_DEFAULT_BUDGETS.root.max_bytes).not.toBe(5000);
  });

  it("emits no substitution notice", () => {
    const resolution = resolveMemoryFileBudgetsFromConfigResult(
      parseYaml(VALID_PROJECT_YAML + VALID_STRICT_CONTEXT_YAML),
    );

    expect(formatMemoryFileBudgetSubstitution(resolution, "/repo")).toBeUndefined();
  });
});

// ─── NEGATIVE: the authored `context` block is unparseable ─────────────────

describe("resolveMemoryFileBudgetsFromConfigResult: unparseable `context` (NEGATIVE)", () => {
  const resolution = (): MemoryFileBudgetResolution =>
    resolveMemoryFileBudgetsFromConfigResult(
      parseYaml(VALID_PROJECT_YAML + INVERTED_THRESHOLD_CONTEXT_YAML),
    );

  it("classifies the fallback as a substitution rather than a plain default", () => {
    expect(resolution().source).toBe("substituted-defaults");
  });

  it("still yields the schema defaults, so the operator's 5000-byte ceiling is provably NOT in effect", () => {
    const budgets = resolution().budgets;

    expect(budgets.root.max_bytes).toBe(SCHEMA_DEFAULT_BUDGETS.root.max_bytes);
    expect(budgets.root.max_bytes).not.toBe(5000);
  });

  it("relays the swallowed schema refusal — the reason names the offending field, not just 'invalid'", () => {
    // reason: the second, INDEPENDENT token. The banner word below proves our
    // own notice fired; this proves the refusal a DIFFERENT mechanism raised
    // (contextConfigSchema's ordered-pair superRefine) is being carried out
    // rather than replaced by a generic message.
    expect(expectSubstituted(resolution()).reason).toContain("evict_threshold_fraction");
  });

  it("renders a notice naming both the substitution and the offending field", () => {
    const notice = formatMemoryFileBudgetSubstitution(resolution(), "/repo");

    expect(notice).toBeDefined();
    expect(notice).toContain("SUBSTITUTED");
    expect(notice).toContain("evict_threshold_fraction");
    expect(notice).toContain("/repo");
  });
});

// ─── BOUNDARY: the three routes that legitimately end at the defaults ──────

describe("resolveMemoryFileBudgetsFromConfigResult: defaults that are NOT substitutions (BOUNDARY)", () => {
  it("a valid config with no `context:` section reports 'config' and stays silent", () => {
    const resolution = resolveMemoryFileBudgetsFromConfigResult(parseYaml(VALID_PROJECT_YAML));

    expect(resolution.source).toBe("config");
    expect(resolution.budgets.root.max_bytes).toBe(SCHEMA_DEFAULT_BUDGETS.root.max_bytes);
    expect(formatMemoryFileBudgetSubstitution(resolution, "/repo")).toBeUndefined();
  });

  it("a config invalid ELSEWHERE but carrying a parseable `context:` salvages the operator's numbers, silently", () => {
    // No `project:` key at all → whole-LoreConfig validation fails, `context` is intact.
    const resolution = resolveMemoryFileBudgetsFromConfigResult(parseYaml(VALID_STRICT_CONTEXT_YAML));

    expect(resolution.source).toBe("context-salvage");
    expect(resolution.budgets.root.max_bytes).toBe(5000);
    expect(formatMemoryFileBudgetSubstitution(resolution, "/repo")).toBeUndefined();
  });

  it("a config invalid ELSEWHERE that never authored `context:` reports 'no-context-section' and stays silent", () => {
    // Nothing was substituted: a VALID config without `context` resolves to
    // these very same defaults, so there is no operator choice being ignored.
    const resolution = resolveMemoryFileBudgetsFromConfigResult(parseYaml(`sync:\n  enabled: true\n`));

    expect(resolution.source).toBe("no-context-section");
    expect(resolution.budgets.root.max_bytes).toBe(SCHEMA_DEFAULT_BUDGETS.root.max_bytes);
    expect(formatMemoryFileBudgetSubstitution(resolution, "/repo")).toBeUndefined();
  });
});

// ─── ERROR: the config file could not be read at all ───────────────────────

describe("resolveMemoryFileBudgetsFromConfigResult: unreadable config file (ERROR)", () => {
  it("a MISSING config file is the legitimate zero-config case — 'no-config', never an announcement", () => {
    const resolution = resolveMemoryFileBudgetsFromConfigResult(
      fsFailureResult("ENOENT", "ENOENT: no such file or directory, open '/repo/.lore/config.yaml'"),
    );

    expect(resolution.source).toBe("no-config");
    expect(formatMemoryFileBudgetSubstitution(resolution, "/repo")).toBeUndefined();
  });

  it("a config file that EXISTS but cannot be read is announced — unreadable is not the same as absent", () => {
    const resolution = resolveMemoryFileBudgetsFromConfigResult(
      fsFailureResult("EACCES", "EACCES: permission denied, open '/repo/.lore/config.yaml'"),
    );

    expect(expectSubstituted(resolution).reason).toContain("EACCES");
    expect(formatMemoryFileBudgetSubstitution(resolution, "/repo")).toContain("SUBSTITUTED");
  });

  it("malformed YAML is announced as UNKNOWN provenance — we cannot even see whether `context` was authored", () => {
    const resolution = resolveMemoryFileBudgetsFromConfigResult(parseYaml("project: [unclosed\n"));

    // The raw `value` here is the YAML TEXT, not an object, so the `context`
    // key is unreadable — the honest verdict is "unknown", never "absent".
    expect(expectSubstituted(resolution).reason).toContain("UNKNOWN");
  });
});

// ─── STATE: the renderer speaks for exactly one discriminant ───────────────

describe("formatMemoryFileBudgetSubstitution: one talking state (STATE)", () => {
  it("is silent for every non-substituted source and speaks only for 'substituted-defaults'", () => {
    const silentSources = ["config", "context-salvage", "no-config", "no-context-section"] as const;

    for (const source of silentSources) {
      const resolution = { source, budgets: SCHEMA_DEFAULT_BUDGETS } as MemoryFileBudgetResolution;
      expect(formatMemoryFileBudgetSubstitution(resolution, "/repo")).toBeUndefined();
    }

    const speaking: MemoryFileBudgetResolution = {
      source: "substituted-defaults",
      budgets: SCHEMA_DEFAULT_BUDGETS,
      reason: "synthetic reason for the state check",
    };
    expect(formatMemoryFileBudgetSubstitution(speaking, "/repo")).toContain("SUBSTITUTED");
  });
});

// ─── REGRESSION: the pre-existing plain-value resolver is untouched ────────

describe("resolveMemoryFileBudgets: unchanged by the provenance seam (REGRESSION)", () => {
  it("still returns the schema defaults for an absent config", () => {
    expect(resolveMemoryFileBudgets(undefined)).toEqual(SCHEMA_DEFAULT_BUDGETS);
  });

  it("still returns the config's own `context.memory_files` when one is present", () => {
    const parsed = parseYaml(VALID_PROJECT_YAML + VALID_STRICT_CONTEXT_YAML);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("fixture must parse");

    expect(resolveMemoryFileBudgets(parsed.value).root.max_bytes).toBe(5000);
  });
});
