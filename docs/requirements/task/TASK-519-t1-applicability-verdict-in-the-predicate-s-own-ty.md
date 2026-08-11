---
id: TASK-519
type: task
role: plan
title: "T1 applicability verdict in the predicate's own type + both plan-close consumers + plan-promote advisory"
status: archived
priority: medium
phase: "Applicability"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-102
plan: PLAN-102
links:
  - {id: TASK-513, type: blocks}
---
## Task Objective

Make "my referent is absent, so I do not apply" a value a predicate RETURNS, and wire the two `plan-close` predicates that need it. No behaviour of any other predicate changes.

Deliver:

1. In `gate-predicates.ts`, additively:
   ```ts
   export type NotApplicableReason = "referent-absent" | "no-evidence";
   export interface PredicateNotApplicable {
     readonly notApplicable: true;
     readonly reason: NotApplicableReason;
     readonly referent: string;
   }
   export type ApplicablePredicateResult = PredicateResult | PredicateNotApplicable;
   ```
   `PredicateResult` is NOT renamed and NOT changed. `PredicateNotApplicable` MUST NOT carry an `ok` property — that omission is the mechanism (reading `.ok` off the union becomes a compile error).
2. `prdOutlineSynced(synced: boolean | null, referent: string): ApplicablePredicateResult` — `null` ⇒ `{notApplicable: true, reason: "referent-absent", referent}`; `true` ⇒ pass; `false` ⇒ the existing fail with the existing reason/field constants (unchanged strings).
3. `attestationFloor` returns `{notApplicable: true, reason: "no-evidence", referent: <plan slug>}` where it previously returned a silent vacuous pass for `total_evidence === 0`. Its `minRatio` parameter stays `number` in this task (T2 widens it).
4. The checkpoint function type in `checkpoint-registry.ts` becomes `(ctx: GateContext) => ApplicablePredicateResult[]`. Every other checkpoint returns only `PredicateResult`s and is assignable unchanged — do not touch them. `checkPlanClose` pushes the n/a values into the same array.
5. `GateEnforcer.enforce` is the ONE consumer that partitions: `notApplicable` entries never deny; each produces (a) an advisory and (b) one best-effort, never-blocking audit row naming the referent (mirror the existing `recordGateSkip` shape — a throwing recorder MUST NOT alter the returned `Result`).
6. Advisories become typed at the enforcer boundary: `{kind: "verify-reachability" | "prd-sync-domain-doc" | "attestation-not-applicable", message: string}`. `ReviewService.approve`'s shipped `reachability_advisories` field keeps carrying ONLY `kind === "verify-reachability"`; the new classes arrive on a new sibling key (`prd_sync_advisories`). Never widen an existing field's meaning.
7. `CorpusService.set`'s plan-close branch stops collapsing absence into a violation: replace `let synced = false; if (domainDoc !== null) {…}` (around corpus-service.ts:2008) with passing `null` when `domainDoc === null`, and the ancestor spec's slug as `referent`.
8. Extract `resolvePrdSyncDomainDoc` out of `CorpusService` into a new module-level function `resolvePrdSyncDomainDoc(store, spec)` in `packages/lore/src/service/prd-sync-domain-doc.ts`, consumed by BOTH `CorpusService` (plan-close) and `ReviewService` (plan-promote). Services must not import each other — this is a store-taking free function, not a service. `CorpusService`'s existing behaviour must not change.
9. `plan-promote` gains a domain-doc advisory (mirror `planPromoteReachabilityAdvisory`'s shape exactly): fires when `prd_sync` is enabled AND the plan's ancestor spec resolves no domain doc; names the spec slug and the `lore link <spec> <domain-spec> --type implements` wiring command; silent when a domain doc resolves.

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` §Design Decisions D1 (the shape, and the two rejected alternatives — read them; do not "improve" the design toward a three-valued `ok`), D2 (two loud channels).

## Acceptance Criteria

- AC-PCI-1 `bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts -t 'notApplicable shape'`
- AC-PCI-2 `bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts -t 'never a fail'`
- AC-PCI-3 `bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts -t 'enforce advisory'`
- AC-PCI-4 `bunx vitest run packages/lore/tests/unit/service/plan-promote-prd-sync-advisory.test.ts -t 'promote advisory'`

The `-t` filter strings are a CONTRACT: your test names must contain them verbatim. Six-dimension coverage (HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION) is required beyond the four pinned tests; write the RED tests first and record the red run as `--result expected-fail` evidence.

## Context Digest

- `PredicateResult` today: `{ok: true} | {ok: false, reason: string, field?: string}`. ~28 predicates return it; 26 of them can never be inapplicable and MUST be left alone.
- `checkPlanClose` (checkpoint-registry.ts ~line 1092) already decides applicability with caller-side `if`s (`ctx.prdSyncSynced !== undefined`, `ctx.requiresUat === true`). Those conditions stay; what changes is that ABSENCE now has its own return value instead of being encoded as `false` two modules away.
- The measured defect this fixes: `spec-context-provenance…`'s parent is the root PRD with no `implements` edge, so `resolvePrdSyncDomainDoc` returns `ok(null)` — a fact — and `let synced = false` turned it into a gate denial that no correct action could clear.
- `GateEnforcer.enforce`'s deny rule is "first failure with a defined field wins"; n/a entries must be invisible to that rule.
- Audit precedent: the config-disabled `gate_skipped` row ("observability never changes the outcome").

## File Anchors

- `packages/lore/src/service/gate-predicates.ts` — the types, `prdOutlineSynced`, `attestationFloor`
- `packages/lore/src/service/checkpoint-registry.ts` — checkpoint fn type, `checkPlanClose`, the new plan-promote advisory
- `packages/lore/src/service/gate-enforcer.ts` — partition, typed advisories, audit row
- `packages/lore/src/service/corpus-service.ts` — plan-close ctx: stop collapsing `null`
- `packages/lore/src/service/review-service.ts` — plan-promote ctx + `prd_sync_advisories`
- `packages/lore/src/service/prd-sync-domain-doc.ts` — NEW shared resolver
- `packages/lore/tests/unit/service/predicate-applicability.test.ts` — NEW
- `packages/lore/tests/unit/service/plan-promote-prd-sync-advisory.test.ts` — NEW
