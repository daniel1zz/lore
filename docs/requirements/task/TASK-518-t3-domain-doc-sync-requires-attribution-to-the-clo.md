---
id: TASK-518
type: task
role: plan
title: "T3 domain-doc sync requires attribution to the closing plan"
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

Require the in-window domain-doc edit that satisfies `prdOutlineSynced` to be ATTRIBUTABLE to the closing plan, so another concurrent session's edit to the same domain doc can no longer report THIS plan as synced.

Deliver, in `CorpusService` (the predicate itself stays a thin verdict — attribution is caller-side, like the window already is):

1. `hasPrdSyncContentDiffInWindow` gains attribution. An in-window `"update"` audit entry whose raw `details.patch.content` differs from its predecessor version satisfies the predicate ONLY when at least one attributor holds:
   - **content attribution** — that raw submitted content contains the closing plan's slug or id, or the governing spec's slug or id; or
   - **edge attribution** — a `relates-to` or `informs` link (either direction) exists between the domain doc and the closing plan, or between the domain doc and the governing spec.
2. Structural relations are NOT attributors: the domain doc being the spec's `parent_id`, and the spec's `implements` edge to it, are the very relations `resolvePrdSyncDomainDoc` used to FIND the domain doc. Accepting them would make the conjunct vacuously true — that is the defect being repaired, not a shortcut. Assert this with a dedicated negative test.
3. Edge attribution is a doc-level fact: resolve it once, then AND it into the per-entry loop. Keep the existing window bounds, the raw-content-vs-predecessor comparison, and the inclusive close bound exactly as they are — the window was never the defect, the missing attribution was.

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` §D6, including its stated residual: spec-level attribution cannot discriminate between sibling plans under the same governing spec. That residual is accepted per the upstream ADR and must be written into the JSDoc as a known limitation — not silently omitted, and not "fixed" by unilaterally dropping spec-level attributors.

## Acceptance Criteria

- AC-PCI-10 `bunx vitest run packages/lore/tests/unit/service/plan-close-prd-sync.test.ts -t 'attribution'`

`-t 'attribution'` is a contract — the test name must contain it verbatim. Required scenarios, all four: unattributed in-window edit → deny; plan slug in content → pass; `relates-to` edge to the plan → pass; structural `parent_id`/`implements` only → deny. Plus six-dimension coverage around them.

## Context Digest

- `hasPrdSyncContentDiffInWindow` is at `corpus-service.ts` ~line 3057; its window-open bound comes from `resolvePrdSyncWindowOpen` (earliest task `extra.claim.at`, else plan `created_at`) and its close bound is the plan-close write's own `now`, compared INCLUSIVELY for a documented reason — do not change either.
- "Substantively edited" is judged against the RAW submitted content on the `"update"` audit entry versus the stored predecessor version, deliberately NOT against post-canonicalisation version bytes. Preserve that; attribution is an additional conjunct, never a replacement.
- The false pass this closes is real for this repo: concurrent worktree sessions routinely touch the same domain doc, and the pre-fix predicate credited whichever plan happened to be closing.
- T1 (already merged) changed `prdOutlineSynced`'s signature to accept `boolean | null` plus a referent. Build on that; do not revert absence handling to a boolean.

## File Anchors

- `packages/lore/src/service/corpus-service.ts` — attribution resolution + the diff loop
- `packages/lore/tests/unit/service/plan-close-prd-sync.test.ts`

## Amendment A (added after T2 landed) — close a silent-fallback the previous slice introduced

T2 shipped `attestationFloor(tasks, minRatio, referent, acCoverage = [])` with the coverage parameter OPTIONAL, defaulting to `[]`, to avoid editing test files outside its own anchors. That default is a silent opt-out of the very conjunct this spec makes the default teeth: any present or future caller that forgets the argument gets a vacuous pass on per-claimed-AC coverage and no diagnostic anywhere. That is the exact defect class the governing spec exists to remove (§D3, and `knowledge-root-cause-synthesis-the-eight-dogfooding-findings`: a proxy whose delta is representable nowhere).

Make it REQUIRED:

1. Remove the `= []` default from `attestationFloor`'s `acCoverage` parameter in `packages/lore/src/service/gate-predicates.ts`.
2. Update every resulting compile error at its call site — there are ~11 `attestationFloor(` call sites across `packages/lore/tests/unit/service/gate-predicates.test.ts` and `packages/lore/tests/unit/service/predicate-applicability.test.ts`. Each must pass an EXPLICIT argument: `[]` where the fixture genuinely has no declared criteria (make that intent visible, e.g. a named `const NO_DECLARED_ACS: readonly AcCoverageFact[] = []`), never a wildcard cast.
3. Do not weaken `deriveAttestationSummary`'s already-required third parameter.
4. Add one test asserting the requirement is structural, not conventional: a call omitting `acCoverage` must not compile. A runtime test cannot express that, so assert it the way this repo already asserts type-level invariants — either an `expect-error`-annotated fixture that the typecheck oracle covers, or an equivalent static assertion. If neither is workable, say so in your report rather than substituting a runtime test that proves something else.

`bun run typecheck` is the primary oracle for this amendment; it must be exit 0 with zero `error TS` lines.

## Amendment B — anchors extended for Amendment A

Add to this task's file anchors: `packages/lore/src/service/gate-predicates.ts`, `packages/lore/tests/unit/service/gate-predicates.test.ts`, `packages/lore/tests/unit/service/predicate-applicability.test.ts`. They are declared on the task record; do not edit any file outside the declared set.
