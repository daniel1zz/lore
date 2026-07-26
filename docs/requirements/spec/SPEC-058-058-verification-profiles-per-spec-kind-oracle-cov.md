---
id: SPEC-058
type: spec
role: spec
title: "SPEC-058 — Verification profiles: per-spec_kind oracle-coverage floors"
status: approved
priority: medium
created: 2026-07-19
updated: 2026-07-22
tags: []
parent: PRD-001
---
# Module Design: Verification profiles — per-spec_kind oracle-coverage floors (PRD §18 P6, spec_kind: tech)

## Overview/Goal

Close the "domain-blind verification" gap: today no gate checks whether a spec's AC set carries the oracle KINDS its domain demands — a `design`-kind UI spec whose ACs are all unit tests passes every gate having never touched a browser. Ship a deterministic, config-driven oracle-coverage floor as a spec-promote predicate (`oracleCoverage`, beside SPEC-052's `acQuantifiable`) plus a plan-promote predicate requiring `requires_uat` on plans under a `design` spec. Deliberately thin (1-2 hard requirements per profile, PRD P6); richer nuance stays AI-advisory (SPEC-053 channel, OUT here). Works on the current task model — independent of SPEC-056/057.

## Scope

**IN**: `@lore/core` `verification-profile.ts` (pure `checkOracleCoverage(criteria, profile)` + `resolveVerificationProfile(config, specKind)`), config namespace `workflow.verification_profiles.<spec_kind>` (`{required_oracles: OracleKind[], required_uat?: boolean}`), spec-promote gate predicate wiring (checkpoint-registry, GateEnforcer inherits — zero adapter changes, SPEC-049 pack included), plan-promote `requires_uat` predicate for plans under a `design`-kind spec, feeding-pack rendering naming each missing oracle kind, recommended-profile block seeded by `lore setup --project` / `lore init` config template (existing corpora: unconfigured → vacuous pass, non-breaking).
**OUT**: AI-advisory vagueness/coverage nuance (SPEC-053's `advisory[]` channel); phase-checklist seeding templates (lands with SPEC-056's `feed phase-start`, which MAY consume `resolveVerificationProfile` — SPEC-056 lists profiles as OUT and has NOT committed to this contract; if it adopts it, SPEC-056 is amended then, not presumed now); browser-verdict attestation kinds (future checklist `bind` member, SPEC-056 OCP slot); any per-AC content inspection beyond the declared `verify` binding (this floor reads oracle kinds, not statements). Discovery for existing corpora is IN (not left silent): plain `lore status` prints a one-line `verification profiles: configured (kinds: …) | not configured` note (SPEC-044/045 armed-count precedent) — opt-in stays opt-in, but discoverable.

## Module Boundary

- **Public API (new)**: `checkOracleCoverage(criteria: AcceptanceCriterion[], profile: VerificationProfile): CoverageFinding[]` (pure — empty array = pass; each finding names the missing oracle kind + the profile source); `resolveVerificationProfile(config: LoreConfig, specKind: SpecKind): VerificationProfile | null` (null = unconfigured → predicate vacuous pass, LOUD in `lore gate` verbose output, silent in enforcement — absence of config is not an event); config schema addition on `@lore/core` config.
- **Internal**: none of substance — this is a two-pure-fn + wiring spec.
- **Dependencies**: existing `acceptanceCriterionSchema` (reads `verify.kind`/`verify.oracle` only), `checkpointRegistry` + `resolveGateEnabled` (SPEC-052 wiring pattern reused). Context plumbing, honestly scoped (review finding): plan-promote genuinely needs ZERO new fields (`buildUpstreamSpecContext` already carries `parentSpec.extra` incl. `spec_kind`); spec-promote needs TWO real call-site edits — `GateContext` gains `specKind` + resolved-profile fields, threaded at `corpus-service.ts:1260` (`set()`'s draft→approved gate) and `review-service.ts:113` (`enforceApprovalGate`), mirroring how spec-create already threads it at `corpus-service.ts:702`.

## Structure

```
packages/core/src/verification-profile.ts        # NEW pure: checkOracleCoverage, resolveVerificationProfile, schemas
packages/core/src/config.ts                      # workflow.verification_profiles.<spec_kind> schema
packages/lore/src/service/checkpoint-registry.ts # oracleCoverage predicate on spec-promote; requiresUat on plan-promote
packages/lore/src/adapters/cli/commands/gate.ts  # ctx threading parity (g2 hook inherits via lore gate, zero hook edits)
assets/project/lore-config-template.yaml         # recommended profile block (design: e2e; feature/tech: test)
```

Test placement: all vitest (pure fns + InMemoryStore gate tests — SPEC-052's own suite layout mirrored).

## Public Interface (TS sketch)

```ts
// @lore/core verification-profile.ts — pure, zero IO
export const verificationProfileSchema = z.object({
  required_oracles: z.array(z.enum(ORACLE_KINDS)).min(1),
  required_uat: z.boolean().optional(),
});
export interface CoverageFinding { missing_oracle: OracleKind; spec_kind: SpecKind; hint: string; }
export function resolveVerificationProfile(config: LoreConfig, specKind: SpecKind): VerificationProfile | null;
export function checkOracleCoverage(criteria: AcceptanceCriterion[], profile: VerificationProfile): CoverageFinding[];
```

Coverage rule: an oracle kind is covered IFF ≥1 declared AC has `verify.mode === "script"` with that `verify.oracle` (ai/human-mode ACs never satisfy a floor — the floor exists precisely to demand deterministic oracles). `required_uat` is checked at plan-promote: a plan whose upstream spec resolves to `spec_kind: design` under a configured `required_uat: true` profile must declare `extra.requires_uat === true` (feeding pack names the exact `lore set <plan> ... ` repair).

## Design Decisions

| Decision | Choice | Rationale | Trade-off |
|---|---|---|---|
| D1 default posture | unconfigured → vacuous pass; recommended block seeded only into NEW corpora via init/setup templates | non-breaking for every existing corpus; SPEC-052 was default-on but linted NEW writes only — a floor re-judges the WHOLE set at promote, stricter blast radius | adoption requires one config paste for existing corpora |
| D2 predicate placement | spec-promote (not spec-create) | ACs accrete via `lore ac add` after create — a create-time floor would block skeleton-first authoring | a spec can sit in draft missing its floor until promote |
| D3 floor semantics | script-mode-only satisfaction | ai/human ACs are precisely what the floor guards against as sole verification | rubric-only design specs must add ≥1 scripted browser/e2e AC |
| D4 requires_uat seam | plan-promote predicate via existing `buildUpstreamSpecContext` | SPEC-054's gate reads `requires_uat` at plan-CLOSE; this closes the loop by ensuring it is SET at plan-PROMOTE | design-spec plans gain one mandatory field |
| D5 no new gate checkpoint | wire into the two EXISTING checkpoints; per-predicate toggles `workflow.gates."spec-promote".oracle_coverage.enabled` + `workflow.gates."plan-promote".requires_uat.enabled` (SPEC-052 `ac_quantifiable.enabled` knob pattern — unconfigured-profile vacuous pass is NOT the disable mechanism, the knob is) | zero hook edits (g2/g3 bridge via `lore gate`), GateEnforcer inheritance free (SPEC-049); knob-pattern consistency | spec-promote needs the two named call-site threading edits (Module Boundary) |
| D6 template file is NEW | `assets/project/lore-config-template.yaml` does not exist today — created by this spec, plus the `lore init`/`lore setup --project` wiring to consume it (no such templating exists to extend) | honest new-surface accounting (review finding) | init/setup flow touch |

## Acceptance Criteria (script-mode, SPEC-052-quantifiable)

- AC-V-1 [script/test] `checkOracleCoverage` suite: 0 failures across >=12 cases — HAPPY (floor met), NEGATIVE (ai-mode AC does NOT satisfy a floor), BOUNDARY (empty criteria vs unconfigured profile distinct outcomes), ERROR (unknown oracle kind in config → typed err at schema parse).
- AC-V-2 [script/test] spec-promote gate: configured design-profile corpus blocks promoting a design spec with zero e2e-bound ACs (feeding pack names "e2e"), same spec + one e2e script AC promotes ok (matched pair); unconfigured corpus promotes byte-identically to the NEW frozen fixture `packages/lore/tests/fixtures/spec-promote-unconfigured-baseline.json` captured from pre-change behavior (REGRESSION); `oracle_coverage.enabled: false` disables with profile configured (knob test); 0 failures.
- AC-V-3 [script/test] plan-promote requires_uat: plan under design spec without extra.requires_uat blocked with repair command in pack, with requires_uat true promotes ok; plan under feature spec unaffected (NEGATIVE); STATE — the promoted plan then archives through SPEC-054's plan-close `uatP0Accepted` gate end-to-end (promote-time floor and close-time verdict compose, the D4 loop asserted not just cited); 0 failures.
- AC-V-4 [script/test] NEW template file + wiring: `assets/project/lore-config-template.yaml` exists, parses with verificationProfileSchema, contains design->e2e + feature->test + tech->test blocks, and a scaffolded corpus's config contains the block (dedicated `verification-profile-template.test.ts`, NOT assets-ssot — that suite is manifest conformance, not schema-content validation); 0 failures.
- AC-V-5 [script/build] `bun run typecheck` exits 0.

## Quality Gates (module)
- [x] No circular dependencies (one new pure core file; wiring in existing registry)
- [x] Single responsibility (coverage computation vs profile resolution vs wiring)
- [x] Public API black-box testable (two pure fns)
- [x] Dependencies injectable (config passed in; zero new IO)


## Acceptance Criteria (structured)

- [✔] [script] AC-V-1: checkOracleCoverage suite passes 0 failures across >=12 cases: floor met (HAPPY), ai-mode AC does NOT satisfy a floor (NEGATIVE), empty criteria vs unconfigured profile distinct outcomes (BOUNDARY), unknown oracle kind in config yields typed schema err (ERROR)
  script: test — bunx vitest run packages/lore/tests/unit/core/verification-profile.test.ts
- [✔] [script] AC-V-2: spec-promote gate matched pair: design spec with 0 e2e-bound ACs blocked with pack naming e2e AND same spec plus one e2e script AC promotes ok; unconfigured corpus byte-identical to frozen fixture spec-promote-unconfigured-baseline.json; oracle_coverage.enabled false disables with profile configured; 0 failures
  script: test — bunx vitest run packages/lore/tests/unit/service/oracle-coverage-gate.test.ts
- [✔] [script] AC-V-3: plan-promote requires_uat: design-spec plan without requires_uat blocked with repair command, with requires_uat true promotes ok, feature-spec plan unaffected, and promoted plan archives end-to-end through the SPEC-054 plan-close uatP0Accepted gate; 0 failures
  script: test — bunx vitest run packages/lore/tests/unit/service/requires-uat-gate.test.ts
- [✔] [script] AC-V-4: NEW assets/project/lore-config-template.yaml exists, parses with verificationProfileSchema, contains design->e2e feature->test tech->test blocks, and a scaffolded corpus config contains the block (dedicated verification-profile-template.test.ts); 0 failures
  script: test — bunx vitest run packages/lore/tests/unit/setup/verification-profile-template.test.ts
- [✔] [script] AC-V-5: bun run typecheck exits 0 across all packages
  script: build — bun run typecheck
- [✘] [script] AC-V-6: lore create plan --requires-uat sets extra.requires_uat===true; the flag is plan-type-only and passing it on any non-plan type exits 4 naming the mismatch; a plan created without it has no requires_uat key. At least 1 CLI test case runs and exits 0
  script: test — cd packages/lore && bun test tests/unit/adapters/cli-create.bun.test.ts
- [✔] [script] AC-V-7: MCP lore_create accepts a requires_uat boolean with plan-only semantics identical to the CLI flag (sets extra.requires_uat===true on a plan; ignored-or-rejected consistently on non-plan types), so an agent creating a design-parented plan over MCP can satisfy the plan-promote requiresUat gate. At least 1 MCP test case runs and exits 0
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-tools.test.ts

## Code anchors

- packages/core/src/verification-profile.ts
- assets/project/lore-config-template.yaml
- packages/lore/src/flows/config-template.ts
