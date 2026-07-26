/**
 * Verification profiles — per-`spec_kind` oracle-coverage floors (SPEC-058).
 * Pure, browser-safe module: no IO, no `Date.now()`/`Math.random()` calls.
 *
 * Public surface:
 *   - verificationProfileSchema / VerificationProfile — one `spec_kind`'s declared
 *     floor: which oracle kinds its acceptance criteria must be script-bound to,
 *     plus an optional `required_uat` flag consumed by the SEPARATE `plan-promote`
 *     `requiresUat` predicate (`packages/lore/src/service/gate-predicates.ts`), and
 *     an optional `min_acs` — the profile-aware acceptance-criteria-COUNT floor
 *     `spec-promote`'s base predicate consults (task-spec-promote-base-1-ac-rule-
 *     is-spec-kind-agnostic-spec-080, option (a)): `0` is legal (a narrative kind
 *     like `domain-overview` needs no declared ACs at all, SPEC-080 C2), an absent
 *     `min_acs` (or an absent profile entirely) keeps the pre-existing "≥1" floor —
 *     see `gate-predicates.ts::acCountMeetsFloor`'s own JSDoc for the exact default
 *     resolution rule.
 *   - CoverageFinding — one `checkOracleCoverage` miss (which oracle kind, and a
 *     human-readable repair hint).
 *   - resolveVerificationProfile(config, specKind) — profile lookup; `null` means
 *     "unconfigured for this spec_kind" (D1 vacuous-pass posture), a fact distinct
 *     from "configured but the declared ACs don't satisfy it" (a non-empty
 *     `checkOracleCoverage` result).
 *   - checkOracleCoverage(criteria, profile) — pure floor-satisfaction check.
 *
 * Coverage rule (SPEC-058 §Design Decisions D3): an oracle kind is "covered" IFF
 * at least one declared acceptance criterion has `verify.mode === "script"` with
 * `verify.oracle` equal to that kind. `ai`-mode and `human`-mode criteria never
 * satisfy a floor — the floor exists precisely to demand a deterministic,
 * machine-run oracle, and neither a rubric nor a human sign-off is one.
 *
 * @invariant `verificationProfileSchema.required_oracles` validates against the
 *   FULL {@link ORACLE_KINDS} enum (task-workflow.ts SSOT) — not the narrower
 *   `SCRIPT_ORACLES` subset (acceptance.ts) — per this spec's own Public
 *   Interface sketch. `checkOracleCoverage` only ever credits a `script`-mode AC
 *   toward coverage regardless of which enum the schema accepts, so declaring
 *   `"manual"` as a required oracle is schema-legal but can never be satisfied —
 *   a corpus author's config mistake, not something this module silently
 *   "fixes" by narrowing the enum out from under the documented public contract.
 * @invariant `CoverageFinding` intentionally omits the `spec_kind` field this
 *   spec's own TS sketch lists — `checkOracleCoverage`'s signature (per that
 *   SAME sketch) never receives a `specKind` parameter, so there is no value to
 *   populate it with here; the caller iterating findings already knows which
 *   spec_kind's profile it resolved and checked.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-058 §Module Boundary, §Public Interface, §Design Decisions D1/D3
 */

import { z } from "zod";
import { ORACLE_KINDS, type OracleKind } from "./task-workflow.js";
import type { SpecKind } from "./spec-kind.js";
import type { AcceptanceCriterion } from "./acceptance.js";
import type { LoreConfig } from "./config.js";

/**
 * One `spec_kind`'s verification-profile floor — the oracle kinds its declared
 * acceptance criteria must be script-bound to, plus an optional UAT requirement
 * and an optional declared-acceptance-criteria-COUNT floor (`min_acs`).
 *
 * @example
 * verificationProfileSchema.parse({ required_oracles: ["e2e"], required_uat: true });
 * @example
 * verificationProfileSchema.safeParse({ required_oracles: [] }); // => success: false (min 1, WHEN present)
 * @example
 * verificationProfileSchema.safeParse({ required_oracles: ["browser-tap"] }); // => success: false
 * @example
 * verificationProfileSchema.parse({ required_oracles: ["e2e"], min_acs: 0 }); // => 0 is legal
 * @example
 * verificationProfileSchema.safeParse({ required_oracles: ["e2e"], min_acs: -1 }); // => success: false
 * @example
 * verificationProfileSchema.parse({ min_acs: 0 }); // => `required_oracles` OMITTED entirely is
 *   legal too (task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080) — a
 *   spec_kind (e.g. `domain-overview`) may opt into ONLY the AC-count floor, no
 *   oracle floor at all. Distinct from `required_oracles: []`, which stays rejected.
 */
export const verificationProfileSchema = z
  .object({
    /**
     * Which oracle kinds this spec_kind's acceptance criteria must be script-bound
     * to. OPTIONAL as of task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-
     * spec-080 (previously required) — a profile entry declaring ONLY `min_acs`
     * (no oracle floor at all) is now legal. `.min(1)` still applies WHENEVER the
     * field IS present — `required_oracles: []` remains a schema-level validation
     * error, unchanged from SPEC-058's original public-interface sketch; only
     * omitting the key entirely is the newly-legal state. `checkOracleCoverage`
     * treats an absent `required_oracles` as `[]` (vacuous pass — zero required
     * oracles, zero possible findings).
     */
    required_oracles: z.array(z.enum(ORACLE_KINDS)).min(1).optional(),
    required_uat: z.boolean().optional(),
    /**
     * Overrides `spec-promote`'s base "≥1 declared acceptance criterion" floor
     * for this spec_kind (task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-
     * spec-080). `0` is a LEGAL value — distinct from omitting the field, which
     * keeps the pre-existing default floor of 1 (see `gate-predicates.ts::
     * acCountMeetsFloor`). A negative value is a schema-level validation error,
     * never silently clamped.
     */
    min_acs: z.number().int().min(0).optional(),
  })
  .strict();

/** Derived TypeScript type for one `spec_kind`'s verification profile. */
export type VerificationProfile = z.infer<typeof verificationProfileSchema>;

/**
 * One `checkOracleCoverage` miss: a `profile.required_oracles` entry no declared
 * `script`-mode acceptance criterion is bound to.
 */
export interface CoverageFinding {
  /** The required oracle kind no declared script-mode AC covers. */
  missing_oracle: OracleKind;
  /** Human-readable repair hint naming the exact `verify` shape that would satisfy it. */
  hint: string;
}

/**
 * Resolves `config`'s declared verification profile for `specKind`.
 *
 * @param config - Parsed LoreConfig, or `undefined` when no `.lore/config.yaml`
 *   was loaded — treated identically to a config with no `workflow.
 *   verification_profiles` section (D1 vacuous-pass posture).
 * @param specKind - Which spec_kind's profile to resolve.
 * @returns The declared {@link VerificationProfile} for `specKind`, or `null`
 *   when unconfigured — absence of the whole config, the `workflow` section, the
 *   `verification_profiles` map, or this specific `specKind`'s entry all mean
 *   the SAME thing: no floor is declared for this spec_kind.
 * @example
 * resolveVerificationProfile(undefined, "design"); // => null
 * @example
 * resolveVerificationProfile(
 *   { project, workflow: { verification_profiles: { design: { required_oracles: ["e2e"] } } } },
 *   "design",
 * ); // => { required_oracles: ["e2e"] }
 * @example
 * resolveVerificationProfile(
 *   { project, workflow: { verification_profiles: { design: { required_oracles: ["e2e"] } } } },
 *   "tech",
 * ); // => null — "tech" has no declared entry, even though "design" does
 */
export function resolveVerificationProfile(
  config: LoreConfig | undefined,
  specKind: SpecKind,
): VerificationProfile | null {
  return config?.workflow?.verification_profiles?.[specKind] ?? null;
}

/**
 * Checks whether `criteria` satisfies `profile`'s oracle-coverage floor.
 *
 * Never throws on malformed criteria (D-required "treated as covering nothing" —
 * a criterion missing/malformed `verify` simply contributes no coverage, rather
 * than aborting the whole check).
 *
 * @param criteria - The candidate/target spec's declared acceptance criteria.
 *   An empty array is a valid input (BOUNDARY — distinct from an unconfigured
 *   profile, which `resolveVerificationProfile` signals via `null` before this
 *   function is ever called).
 * @param profile - The already-resolved verification profile to check against.
 * @returns One {@link CoverageFinding} per `profile.required_oracles` entry with
 *   zero satisfying `script`-mode ACs, in `profile.required_oracles` order;
 *   `[]` when every required oracle is covered, OR when `profile.required_oracles`
 *   is absent entirely (task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-
 *   spec-080 — a profile declaring ONLY `min_acs` has no oracle floor to fail).
 * @example
 * checkOracleCoverage(
 *   [{ id: "AC-1", statement: "x", verify: { mode: "script", oracle: "e2e", command: "bun run e2e" } }],
 *   { required_oracles: ["e2e"] },
 * ); // => []
 * @example
 * checkOracleCoverage(
 *   [{ id: "AC-1", statement: "x", verify: { mode: "ai", rubric: "P95 < 200ms" } }],
 *   { required_oracles: ["e2e"] },
 * ); // => [{ missing_oracle: "e2e", hint: "…" }] — ai-mode never satisfies a floor
 * @example
 * checkOracleCoverage([], { min_acs: 0 }); // => [] — no required_oracles declared at all
 */
export function checkOracleCoverage(
  criteria: AcceptanceCriterion[],
  profile: VerificationProfile,
): CoverageFinding[] {
  const covered = new Set<OracleKind>();
  for (const criterion of criteria) {
    const verify = (criterion as { verify?: unknown } | null | undefined)?.verify as
      | { mode?: unknown; oracle?: unknown }
      | undefined;
    if (verify?.mode === "script" && typeof verify.oracle === "string") {
      covered.add(verify.oracle as OracleKind);
    }
  }

  const findings: CoverageFinding[] = [];
  for (const oracle of profile.required_oracles ?? []) {
    if (!covered.has(oracle)) {
      findings.push({
        missing_oracle: oracle,
        hint: `declare a script-mode acceptance criterion bound to oracle "${oracle}" (verify: { mode: "script", oracle: "${oracle}", command: "…" })`,
      });
    }
  }
  return findings;
}
