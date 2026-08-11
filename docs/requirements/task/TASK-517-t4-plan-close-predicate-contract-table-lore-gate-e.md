---
id: TASK-517
type: task
role: plan
title: "T4 plan-close predicate contract table + lore gate --explain"
status: archived
priority: medium
phase: "Gate wiring"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-102
plan: PLAN-102
links:
  - {id: TASK-512, type: blocks}
---
## Task Objective

Make every `plan-close` predicate's invariant, its actual measurement, and its known deltas machine-readable, so an operator blocked on correctly-executed work reads the delta instead of reaching for an exemption.

Deliver:

1. New `packages/lore/src/service/predicate-contracts.ts`:
   ```ts
   export interface PredicateContract {
     readonly invariant: string;        // what the predicate EXISTS to protect
     readonly measured: string;         // what it actually computes
     readonly known_false_pass: readonly string[];   // cases where measured passes but invariant is violated
     readonly known_false_block: readonly string[];  // cases where measured fails but invariant holds
   }
   export const PREDICATE_CONTRACTS: Record<PlanCloseField, PredicateContract>;
   ```
   `PlanCloseField` is the union of the `*_FIELD` constants `checkPlanClose` can emit (attestation-floor, attestation-exempt-kind, prd-outline-synced, the UAT field, the assessment-freshness field). Build the type FROM those exported constants so adding a plan-close predicate without a contract is a typecheck failure — that compile-time exhaustiveness IS the mechanism; a lookup that returns `undefined` for an unknown field is not.
2. Seed each entry from the predicate's own JSDoc and implementation — do not invent deltas. Known deltas that MUST appear because they are already measured facts:
   - `attestation-floor`: false-block — a plan whose claimed ACs are all attested but whose self-reported development evidence dominates the trail, when `min_ratio` is explicitly configured; false-pass — a plan claiming NO ACs at all passes the coverage conjunct vacuously (flagged earlier by `plan-promote`'s verify-reachability advisory).
   - `prd-outline-synced`: false-pass — spec-level attribution cannot discriminate between sibling plans under the same governing spec; false-block — a plan that introduces no domain-level capability has nothing to write (the deferred `plan-promote` domain-affecting declaration would close this).
   An empty `known_false_*` array means "none recorded", NEVER "none exist" — state that in the module's own doc comment, because the alternative is a fresh proxy for completeness.
3. `lore gate --explain <checkpoint>` prints, per predicate: field, invariant, measured, and both delta lists. Additive flag; `lore gate <checkpoint>` behaviour is untouched. Wire it through the existing CLI command module — no new command.
4. Quote the relevant contract into the feeding pack path for `plan-close` denials, so the delta reaches the operator who is actually blocked. Keep it pointer-sized (field + invariant + measured, not the full lists) and insert it WITHOUT disturbing any byte-pinned pack text.

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` §D7, and §Scope's out-of-scope entry: this table is exhaustive over `plan-close` BY CONSTRUCTION and deliberately does not cover the other checkpoints yet. Do not widen it — a partially-filled `Record` over all seven checkpoints would be a completeness proxy, which is precisely what this spec is about.

## Acceptance Criteria

- AC-PCI-11 `bunx vitest run packages/lore/tests/unit/service/predicate-contracts.test.ts -t 'contract table'`

`-t 'contract table'` is a contract — the test name must contain it verbatim. The exhaustiveness assertion must compare the table's key set against the emitted-field constants programmatically (a hand-written expected list would drift). Add a RED test first proving that a missing entry fails.

## Context Digest

- `checkPlanClose` is at `checkpoint-registry.ts` ~line 1092; the field constants live beside their predicates in `gate-predicates.ts` (`ATTESTATION_FLOOR_FIELD`, `ATTESTATION_EXEMPT_KIND_FIELD`, the prd-outline field, etc.).
- Why this exists: `deriveAttestationSummary`'s own JSDoc already stated that its ratio condition "can be satisfied while the guarantee is violated", and that self-admitted delta ran as the invariant across many plan closes because nothing downstream reads a comment. The contract table is that comment made machine-readable.
- T1 (merged) added `PredicateNotApplicable`; a not-applicable verdict is not a delta — do not model it as one.

## File Anchors

- `packages/lore/src/service/predicate-contracts.ts` — NEW
- `packages/lore/src/service/checkpoint-registry.ts` — field-union export + feeding-pack pointer
- `packages/lore/src/adapters/cli/commands/gate.ts` — `--explain`
- `packages/lore/tests/unit/service/predicate-contracts.test.ts` — NEW

## Amendment A (added after T2 landed) — `?? []` in checkPlanClose is the same silent fallback one layer up

`checkPlanClose` currently calls `attestationFloor(..., ctx.planClaimedAcCoverage ?? [])` (checkpoint-registry.ts ~line 1250). That `?? []` fabricates "this plan declared no criteria" out of "the caller never populated the field" — the unknown-vs-determined conflation this codebase already fixed once at `spec-plan-closure-must-be-loud-terminality-divergence-silent` DD-4(b) (`ReachabilityWhy: "unknown"` vs `"parent-not-spec"`). A gate must never assert a corpus fact it was never given, and here the fabricated fact silently passes the conjunct that this spec makes the default teeth.

Fix it in this task (checkpoint-registry.ts is your anchor):

1. `checkPlanClose` distinguishes the two cases. `ctx.planClaimedAcCoverage === undefined` while the attestation branch is running is a caller-contract violation, not a plan with no ACs: emit `{notApplicable: true, reason: "referent-absent", referent: "planClaimedAcCoverage"}` (T1's type) instead of fabricating `[]`, so the condition is visibly UNEVALUATED rather than silently satisfied. An explicitly-supplied `[]` keeps meaning what it means — a resolved fact that the plan claims no declared script-mode ACs — and still passes vacuously.
2. Do NOT make the `GateContext` field required: that bag is shared by seven checkpoints and a required field would force every unrelated test fixture to supply it. The distinction belongs in the branch that reads it, exactly as DD-4(b) put it in the predicate rather than in the ctx type.
3. Add a test proving the two cases diverge: omitted field → a not-applicable entry, no pass; explicit `[]` → vacuous pass, no not-applicable entry. Name it so `-t 'contract table'` does NOT pick it up (it is a separate assertion from the table's exhaustiveness) and report the command you used.
4. `PREDICATE_CONTRACTS`'s entry for `attestation-floor` must record this in `known_false_pass`: "an unpopulated `planClaimedAcCoverage` ctx field used to fabricate an empty declared-criteria set and pass the coverage conjunct vacuously (fixed here; recorded because the delta is what the table exists to make readable)".

Note: the sibling task T3 (running concurrently) removes the `= []` default from `attestationFloor`'s own parameter in `gate-predicates.ts`. That file is NOT yours — do not edit it. Your call site already passes four arguments, so T3's change does not break your branch.
