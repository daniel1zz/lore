/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-profiles-gate-wiring-
 * threading-status) for `@lore/core`'s `verification-profile.ts` — a module that does
 * NOT exist yet. Covers AC-V-1: `checkOracleCoverage` / `resolveVerificationProfile`,
 * >=12 cases across HAPPY (floor met) / NEGATIVE (ai-mode AC never satisfies a floor) /
 * BOUNDARY (empty criteria vs. unconfigured profile are distinct outcomes) / ERROR
 * (unknown oracle kind in config -> typed schema err).
 *
 * RED mechanism (deliberate, see module-header note below): the module under test is
 * loaded via a dynamic `import()` whose specifier is a COMPUTED (non-literal) string,
 * built from an array `.join("/")` rather than a string literal. TypeScript only
 * performs static module resolution against `import()` calls whose argument is a
 * string literal (empirically verified in-repo: a literal specifier pointing at a
 * missing file fails `tsc --noEmit` with TS2307; the identical computed-specifier
 * form compiles clean) — so `bun run typecheck` stays green today, before
 * `packages/core/src/verification-profile.ts` exists, AND after it lands, with zero
 * edits to this file either way. At runtime today the import genuinely throws
 * ("Cannot find module") inside `beforeAll`, which vitest reports as every `it` in
 * this file failing due to a failed hook — the "import errors against not-yet-
 * existing modules" RED mode this task's AC calls for. Once the implementer creates
 * that file with the exports below, `beforeAll` resolves for real and every
 * assertion runs against the genuine module.
 *
 * Source: spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag
 *   §Public Interface, §Acceptance Criteria AC-V-1.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { AcceptanceCriterion, LoreConfig, SpecKind } from "@lore/core";

// packages/lore/tests/unit/core/ -> ../../../../ -> packages/ -> core/src/verification-profile.js
const VERIFICATION_PROFILE_MODULE_PATH = [
  "..",
  "..",
  "..",
  "..",
  "core",
  "src",
  "verification-profile.js",
].join("/");

/** The module's expected public shape, loosely typed — the real module's exports are
 *  the source of truth once it exists; this is only enough structure to call through. */
interface VerificationProfileModule {
  checkOracleCoverage: (
    criteria: AcceptanceCriterion[],
    profile: { required_oracles: string[]; required_uat?: boolean },
  ) => Array<{ missing_oracle: string; spec_kind: string; hint: string }>;
  resolveVerificationProfile: (
    config: LoreConfig,
    specKind: SpecKind,
  ) => { required_oracles: string[]; required_uat?: boolean } | null;
  verificationProfileSchema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } };
}

let mod: VerificationProfileModule;

beforeAll(async () => {
  mod = (await import(VERIFICATION_PROFILE_MODULE_PATH)) as unknown as VerificationProfileModule;
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function scriptAc(id: string, oracle: string, statement = `${id} oracle-bound claim`): AcceptanceCriterion {
  return {
    id,
    statement,
    verify: { mode: "script", oracle, command: `bun test ${id}.test.ts` },
  } as AcceptanceCriterion;
}

function aiAc(id: string, rubric = "P95 < 200ms"): AcceptanceCriterion {
  return {
    id,
    statement: `${id} ai-judged claim`,
    verify: { mode: "ai", rubric },
  } as AcceptanceCriterion;
}

function humanAc(id: string): AcceptanceCriterion {
  return {
    id,
    statement: `${id} human-checked claim`,
    verify: { mode: "human" },
  } as AcceptanceCriterion;
}

const DESIGN_E2E_PROFILE = { required_oracles: ["e2e"] };
const DESIGN_MULTI_PROFILE = { required_oracles: ["e2e", "test"] };

function configuredConfig(): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    workflow: {
      verification_profiles: {
        design: { required_oracles: ["e2e"] },
        feature: { required_oracles: ["test"] },
      },
    },
  } as unknown as LoreConfig;
}

function unconfiguredConfig(): LoreConfig {
  return { project: { name: "t", author: "t" } } as unknown as LoreConfig;
}

// ─── AC-V-1: checkOracleCoverage — HAPPY (floor met) ─────────────────────────

describe("checkOracleCoverage — HAPPY: floor met", () => {
  it("a single required oracle covered by ONE matching script AC yields zero findings", () => {
    const findings = mod.checkOracleCoverage([scriptAc("AC-1", "e2e")], DESIGN_E2E_PROFILE);
    expect(findings).toEqual([]);
  });

  it("multiple required oracles, each covered by a DISTINCT script AC, yields zero findings", () => {
    const findings = mod.checkOracleCoverage(
      [scriptAc("AC-1", "e2e"), scriptAc("AC-2", "test")],
      DESIGN_MULTI_PROFILE,
    );
    expect(findings).toEqual([]);
  });

  it("an EXTRA, unrelated script AC alongside a satisfying one still yields zero findings", () => {
    const findings = mod.checkOracleCoverage(
      [scriptAc("AC-1", "e2e"), scriptAc("AC-2", "lint")],
      DESIGN_E2E_PROFILE,
    );
    expect(findings).toEqual([]);
  });
});

// ─── AC-V-1: checkOracleCoverage — NEGATIVE (non-script modes never satisfy) ─

describe("checkOracleCoverage — NEGATIVE: non-script verify modes never satisfy a floor", () => {
  it("an ai-mode AC does NOT satisfy the floor, even with a measurable rubric — finding names the missing oracle", () => {
    const findings = mod.checkOracleCoverage([aiAc("AC-1", "e2e coverage P95 < 5s")], DESIGN_E2E_PROFILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.missing_oracle).toBe("e2e");
  });

  it("a human-mode AC does NOT satisfy the floor", () => {
    const findings = mod.checkOracleCoverage([humanAc("AC-1")], DESIGN_E2E_PROFILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.missing_oracle).toBe("e2e");
  });

  it("a script-mode AC bound to the WRONG oracle does NOT satisfy the floor", () => {
    const findings = mod.checkOracleCoverage([scriptAc("AC-1", "test")], DESIGN_E2E_PROFILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.missing_oracle).toBe("e2e");
  });

  it("partial coverage: one of two required oracles covered still reports exactly the uncovered one", () => {
    const findings = mod.checkOracleCoverage([scriptAc("AC-1", "e2e")], DESIGN_MULTI_PROFILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.missing_oracle).toBe("test");
  });
});

// ─── AC-V-1: checkOracleCoverage — BOUNDARY ──────────────────────────────────

describe("checkOracleCoverage / resolveVerificationProfile — BOUNDARY", () => {
  it("empty criteria array against a CONFIGURED profile reports one finding per required oracle", () => {
    const findings = mod.checkOracleCoverage([], DESIGN_MULTI_PROFILE);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.missing_oracle).sort()).toEqual(["e2e", "test"]);
  });

  it("resolveVerificationProfile on an UNCONFIGURED corpus returns null (distinct from an empty-criteria finding set)", () => {
    const profile = mod.resolveVerificationProfile(unconfiguredConfig(), "design");
    expect(profile).toBeNull();
  });

  it("resolveVerificationProfile on a CONFIGURED corpus returns the matching non-null profile for that spec_kind", () => {
    const profile = mod.resolveVerificationProfile(configuredConfig(), "design");
    expect(profile).not.toBeNull();
    expect(profile?.required_oracles).toEqual(["e2e"]);
  });

  it("resolveVerificationProfile does not cross-leak between spec_kinds — 'feature' resolves its OWN profile, not design's", () => {
    const profile = mod.resolveVerificationProfile(configuredConfig(), "feature");
    expect(profile).not.toBeNull();
    expect(profile?.required_oracles).toEqual(["test"]);
  });

  it("resolveVerificationProfile returns null for a spec_kind with no declared profile even when OTHER kinds are configured", () => {
    const profile = mod.resolveVerificationProfile(configuredConfig(), "tech");
    expect(profile).toBeNull();
  });

  it("a criterion with a missing/malformed verify field is treated as covering nothing, never throws", () => {
    const malformed = [{ id: "AC-1", statement: "no verify field at all" }] as unknown as AcceptanceCriterion[];
    expect(() => mod.checkOracleCoverage(malformed, DESIGN_E2E_PROFILE)).not.toThrow();
    expect(mod.checkOracleCoverage(malformed, DESIGN_E2E_PROFILE)).toHaveLength(1);
  });
});

// ─── AC-V-1: verificationProfileSchema — ERROR (unknown oracle kind) ─────────

describe("verificationProfileSchema — ERROR: unknown oracle kind", () => {
  it("rejects an unknown oracle kind in required_oracles with a typed (non-thrown) schema error", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: ["browser-tap"] });
    expect(result.success).toBe(false);
  });

  it("accepts every genuine SCRIPT_ORACLES member (sanity: the schema isn't rejecting valid input too)", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: ["e2e", "test", "tsc"] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty required_oracles array (min(1) per the spec's public-interface sketch)", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: [] });
    expect(result.success).toBe(false);
  });

  it("accepts an optional required_uat boolean alongside required_oracles", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: ["e2e"], required_uat: true });
    expect(result.success).toBe(true);
  });
});

// ─── task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 (option (a)) ──
// min_acs — the profile-aware `spec-promote` AC-count floor — plus `required_oracles`
// becoming optional so a `min_acs`-only profile entry (e.g. `domain-overview`) is
// expressible without a meaningless oracle-coverage floor bolted on.

describe("verificationProfileSchema — min_acs (task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080)", () => {
  // HAPPY — 0 is a legal, distinct-from-absent value
  it("accepts min_acs: 0 alongside required_oracles", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: ["e2e"], min_acs: 0 });
    expect(result.success).toBe(true);
  });

  // HAPPY — required_oracles is now OPTIONAL: a min_acs-only profile (the
  // domain-overview shape — no oracle floor at all) is legal
  it("accepts a profile declaring ONLY min_acs, with required_oracles omitted entirely", () => {
    const result = mod.verificationProfileSchema.safeParse({ min_acs: 0 });
    expect(result.success).toBe(true);
  });

  // BOUNDARY — an EMPTY required_oracles array stays rejected (distinct from
  // omitting the field) — the pre-existing min(1)-when-present rule is unchanged
  it("still rejects an EMPTY required_oracles array even alongside min_acs (distinct from omission)", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: [], min_acs: 0 });
    expect(result.success).toBe(false);
  });

  // NEGATIVE — a negative min_acs is a schema-level error, never silently clamped
  it("rejects a negative min_acs", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: ["e2e"], min_acs: -1 });
    expect(result.success).toBe(false);
  });

  // NEGATIVE — a non-integer min_acs is rejected
  it("rejects a non-integer min_acs", () => {
    const result = mod.verificationProfileSchema.safeParse({ required_oracles: ["e2e"], min_acs: 1.5 });
    expect(result.success).toBe(false);
  });

  // BOUNDARY — checkOracleCoverage on a required_oracles-less profile yields zero
  // findings regardless of declared criteria (nothing to satisfy)
  it("checkOracleCoverage returns [] for a profile with no required_oracles at all", () => {
    const criteria: AcceptanceCriterion[] = [];
    expect(mod.checkOracleCoverage(criteria, { min_acs: 0 } as never)).toEqual([]);
  });
});
