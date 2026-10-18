/**
 * @spec_ref AC-GI-14 (spec-the-defect-channel-reaches-no-machine-but-its-own-github)
 * @task task-skill-test-retired-transport-keys-parse-with-warnings
 * @tdd_role red — paired implementation: task-skill-implement-delete-the-sqlite-transport-modules-retire
 *
 * RED test suite proving `feedback.upstream.corpus_path` and the retired
 * `transport` seam key parse SUCCESSFULLY, with a NAMED warning, once the
 * SQLite transport modules that once consumed them are deleted (P4 of
 * plan-land-the-github-intake-defect-channel-runner-cap-removal).
 *
 * Design decision this test locks in (spec §Migration Plan P4 / the "no
 * config key is described as deleted anywhere" revision): `FeedbackConfigSchema`
 * is `.strict()` at three levels (packages/core/src/config.ts:738-793).
 * Deleting `corpus_path`/`transport` outright would make ANY config still
 * carrying them fail to parse *machine-wide* — and `.lore/config.yaml` is
 * gitignored (.gitignore:18), so a binary downgrade cannot un-edit a
 * consumer's file. The fix the paired implementation task commits to is
 * therefore `.optional()` + a named warning, never removal — mirroring the
 * treatment AC-GI-10 already requires for the retired
 * `feedback.inbound.open_report_cap` key, held as its own AC/file so P1 and
 * P4 gate independently (one AC covering three keys can pass while testing
 * only one).
 *
 * Warning surface asserted here: `console.warn`. This is the ONE existing
 * precedent in this exact module for "deprecated-but-not-deleted config key"
 * (the `workflow.gates."task-claim"` -> `"phase-claim"` alias warning,
 * `phaseClaimAliasWarned` around config.ts:1205-1250) — no return-value
 * warnings channel exists anywhere in `parseConfig`'s ~dozen call sites
 * today, and that precedent's own JSDoc explicitly rejects threading a
 * warning collector through all of them. This test does not invent a second
 * channel; it holds the implementation to the one that already exists.
 * Assertions only check that the retired key's NAME appears somewhere in the
 * accumulated `console.warn` text — loose enough to leave exact wording to
 * the implementer, strict enough that an else-if bug which only ever names
 * the first of two present keys is caught (scenario 3 below).
 *
 * Today (pre-P4): `corpus_path` is REQUIRED (`z.string().min(1)`, not
 * optional) and `transport` is not a declared key at all (only a comment:
 * "P2 seam (named, NOT implemented)"). Every HAPPY scenario below MUST fail
 * until the paired implementation task lands — either because no warning is
 * emitted (scenario 1, since corpus_path parses fine today with no warning)
 * or because parsing itself still fails (scenarios 2 and 3, since `transport`
 * is an unrecognized key and/or `corpus_path` is absent-but-required today).
 *
 * Test plan (six-dimension, scoped to this task's four mandated scenarios):
 * HAPPY: corpus_path alone warns+parses; transport alone warns+parses; both
 *   together name BOTH in warnings (not just the first).
 * NEGATIVE: an unrelated unknown key under feedback.upstream still fails —
 *   proves strict mode was not blanket-relaxed via `.passthrough()`.
 * BOUNDARY: n/a for this task — no numeric/length edge is in scope here.
 * ERROR: the NEGATIVE case above IS the error-path assertion (VALIDATION_ERROR,
 *   field pinned to the exact dotted key path).
 * STATE: n/a — `parseConfig` is a pure, stateless function.
 * REGRESSION: n/a — first test of this specific behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig, retiredConfigKeyNotices } from "@lore/core";

/** Minimal valid top-level config — `project` is the only required section. */
function baseConfig() {
  return {
    project: { name: "lore", author: "owner" },
  };
}

/** The by-name notices a raw config earns, as one searchable string (the schema itself prints nothing). */
function warnedText(raw: unknown): string {
  return retiredConfigKeyNotices(raw).join("\n");
}

describe("retired transport keys parse with warnings while strict mode holds (AC-GI-14)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("HAPPY: a config carrying feedback.upstream.corpus_path parses successfully and a warning names corpus_path", () => {
    const raw = {
      ...baseConfig(),
      feedback: {
        upstream: {
          corpus_path: "/abs/path/to/upstream-repo",
          root_prd: "prd-upstream-root",
        },
      },
    };

    const result = parseConfig(raw);

    expect(result.ok).toBe(true);
    expect(warnedText(raw)).toContain("corpus_path");
  });

  it("HAPPY: a config carrying the retired transport key parses successfully and a warning names transport", () => {
    const raw = {
      ...baseConfig(),
      feedback: {
        upstream: {
          root_prd: "prd-upstream-root",
          transport: "sqlite",
        },
      },
    };

    const result = parseConfig(raw);

    expect(result.ok).toBe(true);
    expect(warnedText(raw)).toContain("transport");
  });

  it("HAPPY: a config carrying BOTH retired transport keys names both in warnings — not just the first", () => {
    const raw = {
      ...baseConfig(),
      feedback: {
        upstream: {
          corpus_path: "/abs/path/to/upstream-repo",
          root_prd: "prd-upstream-root",
          transport: "sqlite",
        },
      },
    };

    const result = parseConfig(raw);

    expect(result.ok).toBe(true);
    const text = warnedText(raw);
    expect(text).toContain("corpus_path");
    expect(text).toContain("transport");
  });

  it("NEGATIVE: an unrelated unknown key under feedback.upstream still fails — strict mode survives the targeted exemptions", () => {
    const raw = {
      ...baseConfig(),
      feedback: {
        upstream: {
          corpus_path: "/abs/path/to/upstream-repo",
          root_prd: "prd-upstream-root",
          totally_unrelated_typo: "oops",
        },
      },
    };

    const result = parseConfig(raw);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      // Narrowing guard (not a weakened assertion): `expect(...).toBe(...)`
      // above is a runtime check only — it does not narrow the `LoreError`
      // union for TypeScript, so `.field` (declared only on the
      // VALIDATION_ERROR member) is unreachable without this `if`. The
      // preceding expect already fails the test if code is anything else,
      // so this guard is always entered on a passing run — it doesn't skip
      // or loosen the field assertion, only makes it type-check.
      if (result.error.code === "VALIDATION_ERROR") {
        expect(result.error.field).toBe("feedback.upstream.totally_unrelated_typo");
      } else {
        throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
      }
    }
  });
});
