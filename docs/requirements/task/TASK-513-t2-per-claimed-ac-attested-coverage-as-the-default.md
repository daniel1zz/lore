---
id: TASK-513
type: task
role: plan
title: "T2 per-claimed-AC attested coverage as the default conjunct, ratio opt-in, render parity"
status: archived
priority: medium
phase: "Coverage core"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-102
plan: PLAN-102
links:
  - {id: TASK-518, type: blocks}
  - {id: TASK-517, type: blocks}
  - {id: TASK-515, type: blocks}
---
## Task Objective

Replace `attestationFloor`'s plan-wide ratio with per-claimed-AC attested coverage as the DEFAULT, keep the ratio as an opt-in conjunct that never silently relaxes an expressed threshold, and carry both through every read surface so the gate and the dashboard cannot disagree.

Deliver:

1. `packages/core/src/evidence-panel.ts`:
   ```ts
   export interface ClaimedAcCoverage {
     claimed_acs: string[];      // declared script-mode criteria carrying >=1 evidence ref, in declaration order
     unattested_acs: string[];   // subset with attested_pass + attested_fail === 0
     meets_coverage: boolean;    // unattested_acs.length === 0 (vacuously true when claimed_acs is empty)
   }
   export function deriveClaimedAcCoverage(coverage: readonly AcCoverageFact[]): ClaimedAcCoverage;
   ```
   Input is `computeAcCoverage`'s own output (`packages/core/src/acceptance.ts`) — do NOT re-implement any counting. `AcCoverageFact` already carries `mode`, `refs`, `attested_pass`, `attested_fail`. Because `computeAcCoverage` emits one row per DECLARED criterion, dangling `ac_ref`s are excluded structurally: do not add a filter for them, and say so in the JSDoc.
2. `AttestationSummary` gains `claimed_ac_coverage: ClaimedAcCoverage` and its `min_ratio` becomes `number | null`. `deriveAttestationSummary(infos, minRatio: number | null, acCoverage: readonly AcCoverageFact[])` — third parameter REQUIRED (an optional one would let a caller silently opt out of the conjunct). `meets_floor` = no zero-attested evidence-bearing task AND `claimed_ac_coverage.meets_coverage` AND (`minRatio === null` || `ratio >= minRatio`). The `total_evidence === 0` early return keeps returning `meets_floor: true` — T1 already made the PREDICATE report that case as not-applicable; this stays a facts function.
3. `packages/core/src/config.ts`: `min_ratio` becomes `z.number().min(0).max(1).optional()` — the `.default(0.5)` is DELETED, because a Zod default makes "absent" and "explicitly 0.5" indistinguishable at every read site, which is the exact migration rule this AC set pins. `resolveAttestationMinRatio(config): number | null` returns the explicit value or `null`. Update the `DEFAULT_ATTESTATION_MIN_RATIO` constant in `checkpoint-registry.ts` to `null` and make the ctx read `ctx.attestationMinRatio ?? null` (a `?? 0.5` would resurrect the flipped default).
4. `attestationFloor(tasks, minRatio: number | null, acCoverage: readonly AcCoverageFact[])`; `GateContext` gains `planClaimedAcCoverage?: readonly AcCoverageFact[]` and widens `attestationMinRatio` to `number | null`. `checkPlanClose` passes `ctx.planClaimedAcCoverage ?? []`.
5. `CorpusService.set`'s plan-close branch computes `planClaimedAcCoverage` = `computeAcCoverage(<declared criteria of bundle.spec>, bundle.tasks)`, or `[]` when `bundle.spec === undefined`. Reuse the existing declared-criteria extraction path (the same one `AcService` / `countScriptModeAcceptanceCriteria` use) — no hand-rolled `extra.acceptance_criteria` parsing.
6. `feedAttestationFloor` (checkpoint-registry.ts): name every `unattested_acs` id; print the ratio-vs-floor line ONLY when `min_ratio` is non-null, and when printed it MUST contain the literal substring `attested ratio`. Insert all new text BEFORE the byte-pinned `Recovery: run \`lore verify …\`` sentence — `feed-attestation-reachability.test.ts`'s fixture must keep passing untouched.
7. `VerificationProjectionService` passes `min_ratio` through as `null` verbatim (never coerced) and supplies the same `computeAcCoverage` facts the gate uses, so its `claimed_ac_coverage` equals the gate's. `PlanAttestationPanel.tsx` renders the literal text `ratio conjunct disabled` for the null case and the numeric floor otherwise; the null case must render neither `0%` nor `50%`.

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` §D3 (the three conditions and WHY the claimed set is intersected with declared script-mode criteria — a dangling or `human`-mode AC can never be runner-attested, so demanding it would be a permanent false block), §D4 (default flip + migration), §D5 (feeding pack). Upstream: `adr-ac-as-code-oracle` establishes that per-AC coverage is computed by a pure function and NEVER persisted, and that judgment is rendered against the DECLARED criterion set.

Counting rule, pinned: "attested" = `attested_pass + attested_fail >= 1`, never `attested_pass` alone. A runner-issued fail still proves the runner ran that AC's registered command, which is what this predicate measures.

## Acceptance Criteria

- AC-PCI-5 `bunx vitest run packages/core/src/evidence-panel.test.ts -t 'claimed set'`
- AC-PCI-6 `bunx vitest run packages/core/src/evidence-panel.test.ts -t 'coverage conjunct'`
- AC-PCI-7 `bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t 'ratio disabled'`
- AC-PCI-8 `bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t 'explicit ratio'`
- AC-PCI-9 `bunx vitest run packages/lore/tests/unit/service/feed-attestation-ac-diagnostics.test.ts packages/lore/tests/unit/service/feed-attestation-reachability.test.ts -t 'unattested naming'`
- AC-PCI-13 `bunx vitest run packages/lore/tests/unit/service/verification-projection-service.test.ts -t 'ratio disabled render'`
- AC-PCI-14 `cd packages/dashboard && bunx vitest run tests/component/PlanAttestationPanel.test.tsx -t 'ratio disabled render'`

`-t` strings are a contract — your test names must contain them verbatim. AC-PCI-7/8 must drive the REAL gate through `CorpusService.set`, not the predicate in isolation.

## Context Digest

- Motivating measurement: the plan this fixes has ratio 0.36 (35 honest self-reported red→green records in the denominator) and 7/7 claimed-AC coverage. The ratio rewarded re-running an already-green oracle and punished evidence discipline.
- The two predicates are INCOMPARABLE, not ordered — coverage catches "this claimed AC was never runner-attested", the ratio catches "self-reported entries dominate". That is why the ratio survives as an AND-ed opt-in rather than being deleted.
- `deriveAttestationSummary` has exactly two production callers: `attestationFloor` and `VerificationProjectionService`. Both must be updated; the dashboard imports only `@lore/core` (never `@lore/core/node`) — keep `evidence-panel.ts` browser-safe (no fs/path/os).
- `@lore/core` is a workspace package: after changing its exports, dependents in a fresh worktree need `bun install` first, and a cache-hit "pass" from a shared turbo/nx-style cache is not evidence.

## File Anchors

- `packages/core/src/evidence-panel.ts`, `packages/core/src/evidence-panel.test.ts`
- `packages/core/src/config.ts`
- `packages/core/src/index.ts` — export the new type/function
- `packages/lore/src/service/gate-predicates.ts`
- `packages/lore/src/service/checkpoint-registry.ts`
- `packages/lore/src/service/corpus-service.ts`
- `packages/lore/src/service/verification-projection-service.ts`
- `packages/dashboard/src/components/evidence/PlanAttestationPanel.tsx`
- `packages/lore/tests/unit/service/attestation-floor.test.ts`
- `packages/lore/tests/unit/service/feed-attestation-ac-diagnostics.test.ts` — NEW
- `packages/lore/tests/unit/service/verification-projection-service.test.ts`
- `packages/dashboard/tests/component/PlanAttestationPanel.test.tsx`

## Amendment (authored after T1 landed — the corpus is the SSOT, this section wins over any earlier signature sketch above)

T1 shipped `attestationFloor(tasks, minRatio, referent)` returning `ApplicablePredicateResult` (it reports the zero-evidence case as `notApplicable("no-evidence", referent)`). Read the CURRENT signature in `gate-predicates.ts` and EXTEND it — do not retype it from the sketch above and do not drop the `referent` parameter, which AC-PCI-3's audit-row assertion depends on. The same applies to `prdOutlineSynced(synced: boolean | null, referent)` and to `CheckpointDef.check`'s `ApplicablePredicateResult[]` return type, plus `GateContext.prdSyncSynced: boolean | null` and `GateContext.prdSyncDomainDocResolved`.

Concurrency note: a DIFFERENT session is live in this same checkout and corpus, holding `packages/core/src/session.ts`, `packages/lore/src/flows/feed-flow.ts` and two of their tests. Those do not intersect your anchors. If you find yourself needing to edit any of them, STOP and report instead of editing — that is a foreign claim.
