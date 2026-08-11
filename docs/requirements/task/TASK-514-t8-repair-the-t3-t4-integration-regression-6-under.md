---
id: TASK-514
type: task
role: plan
title: "T8 repair the T3+T4 integration regression (6 under-specified fixtures) + per-referent advisory kind"
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

Repair a cross-anchor integration regression and one wrong audit label, both introduced by the T3+T4 merge. Measured on the merged tree at commit `5fcb07f`: `bun run typecheck` is exit 0 with zero `error TS`, but `bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts` is **exit 1 with 6 failed / 13 passed**. The six failures are AC-PCI-2's and AC-PCI-3's OWN tests, so two ACs that already carry `pass` evidence are currently RED.

### Part 1 — the six under-specified fixtures (the regression)

Failing tests, verbatim from the run:

- `checkPlanClose — never a fail on an absent domain doc (AC-PCI-2) > NEGATIVE: a resolved-but-unsynced domain doc still produces a real prd-outline-synced failure`
- `… (AC-PCI-2) > BOUNDARY: a resolved and synced domain doc produces a plain pass, never notApplicable`
- `… (AC-PCI-2) > STATE: no spec-tier ancestor at all (prdSyncSynced undefined) pushes no prd-sync entry whatsoever`
- `… (AC-PCI-2) > ERROR: prd_sync disabled by config means the predicate never runs even with a null referent`
- `GateEnforcer.enforce — enforce advisory on plan-close not-applicable (AC-PCI-3) > HAPPY: enforce returns ok and records one audit row naming the absent referent`
- `… (AC-PCI-3) > STATE: a plan-close call with no not-applicable verdicts never fires the not-applicable audit`

Cause: each builds a hand-rolled `GateContext` that OMITS `planClaimedAcCoverage`. T4's Amendment A retired the old `?? []` fabrication, so an omitted field now correctly emits a companion `notApplicable{reason:"referent-absent", referent:"planClaimedAcCoverage"}`. The fixtures were written under the old semantics and never meant to say anything about coverage.

Fix: give each of those fixtures an EXPLICIT `planClaimedAcCoverage: []`. That is not a workaround — under the new semantics `[]` is the resolved fact "this plan claims no declared script-mode ACs", which is exactly what those fixtures mean, and it makes their intent visible. Do NOT weaken T4's distinction, do NOT restore any `?? []`, and do NOT delete or `skip` a failing assertion.

Verify by running the file BOTH filtered and unfiltered, and report the matched counts:
- `bunx vitest run packages/lore/tests/unit/service/predicate-applicability.test.ts` → must be 19/19 pass, exit 0
- the three pinned AC commands (`-t 'notApplicable shape'`, `-t 'never a fail'`, `-t 'enforce advisory'`) → each exit 0 with a non-zero matched count

Then record FRESH evidence for AC-PCI-2 and AC-PCI-3 on THIS task. Their earlier `pass` entries on T1 were true when recorded and are append-only; the fresh entries are what makes the current tree's state auditable.

### Part 2 — the wrong audit label

`packages/lore/src/service/gate-enforcer.ts`'s `notApplicableAdvisoryKind` maps EVERY `reason: "referent-absent"` to advisory kind `"prd-sync-domain-doc"`. That 1:1 assumption held only while `prdOutlineSynced` was the sole producer of that reason. T4's companion entry now also produces `"referent-absent"` with `referent: "planClaimedAcCoverage"`, so its audit row is labelled as a prd-sync domain-doc issue when it is an attestation-coverage issue.

This is not cosmetic: an audit row that names the wrong subject is a record asserting something untrue, which is the exact defect class the governing spec exists to remove. Fix it by keying the advisory kind on the `referent` (or on an explicitly carried kind), not on the `reason` alone. Keep `"verify-reachability"`'s and `"prd-sync-domain-doc"`'s existing meanings byte-identical; the attestation case gets its own kind (`"attestation-not-applicable"` already exists in the union T1 declared — use it rather than inventing a new one).

Add a test asserting the mapping is per-referent: a `planClaimedAcCoverage` referent yields the attestation kind, a domain-doc referent yields the prd-sync kind, and neither leaks into the other. RED first — the test must fail against current source before you fix the mapping.

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` §D2 (typed advisory kinds; an existing field never widens its meaning) and §D3. Part 1 defends T4's Amendment A distinction; Part 2 completes §D2's typed-channel intent.

## Acceptance Criteria

No new spec AC. This task re-establishes AC-PCI-2 and AC-PCI-3 on the merged tree and must record fresh `pass` evidence for both, plus a `pass` for `bun run typecheck` and for the scoped test selection. Part 2's mapping test is task-level (report its exact command); it is the oracle for a defect found at integration, not a new spec obligation.

## Context Digest

- Merged tree under repair: `5fcb07f` (T3 `2820b96` + T4 `136f9ad` + T7 `ea0e009` all merged, no conflicts).
- T4 deliberately did NOT edit `predicate-applicability.test.ts` — it is not its anchor, and reporting the breakage instead of reaching across was correct. This task is where that hand-off lands.
- `attestationFloor`'s `acCoverage` parameter is REQUIRED as of T3 (no `= []`), asserted type-level via a `@ts-expect-error` fixture whose trap was verified by temporarily restoring the default. Do not disturb that.
- ⛔ A DIFFERENT session is live in this same checkout and corpus, holding `packages/core/src/session.ts`, `packages/lore/src/flows/feed-flow.ts` and their tests, and committing directly onto the shared branch. Your two anchors are yours; if you appear to need any other file, STOP and report.

## File Anchors

- `packages/lore/tests/unit/service/predicate-applicability.test.ts`
- `packages/lore/src/service/gate-enforcer.ts`
