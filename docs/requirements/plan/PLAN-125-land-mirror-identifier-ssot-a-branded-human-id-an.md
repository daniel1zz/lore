---
id: PLAN-125
type: plan
role: plan
title: "Land mirror identifier SSOT: a branded human_id, an idempotent migrate-export seam, and a drift check that writes nothing"
status: archived
priority: high
created: 2026-08-11
updated: 2026-08-18
tags: []
parent: SPEC-135
phases:
  - {name: "reconcile", description: "D1/D2: step-3 reconcile composes via formatMirrorHumanId; padded report/rename fields with new_display left unpadded; AC-084-4 re-baselined in place (AC-MIS-1, AC-MIS-2, AC-MIS-4)"}
  - {name: "brand", description: "D3/D4: MirrorHumanId nominal type on exportIndexMappingSchema.human_id, single sanctioned cast at the schemas.ts parse boundary, cast-escape rule in check-ordinal-write-sites (AC-MIS-3, AC-MIS-6). BLOCKED BY reconcile"}
  - {name: "readonly", description: "D5: runCheck reports drift and writes nothing, driven against a throwaway corpus (AC-MIS-5). Concurrent with reconcile"}
---
# Goal

Land the six ACs of `spec-mirror-identifier-ssot-one-writer-for-export-index-human`. Each exists
because the mirror's `human_id` field has two live writers that disagree and silently revert each
other, and the only "one composition site" enforcement in the tree is JSDoc prose.

## Phases

**Phase 1 — `reconcile` (AC-MIS-1, AC-MIS-2, AC-MIS-4).** D1/D2: the step-3 reconcile composes via
`formatMirrorHumanId`, the four report/rename fields go padded while `new_display` stays unpadded,
and AC-084-4's pins are re-baselined with an in-place justification citing `ordinal.ts:133-145` /
`2026-08-10`. No brand yet, so `bun run typecheck` stays green throughout this phase.

**Phase 2 — `brand` (AC-MIS-3, AC-MIS-6).** D3/D4: `MirrorHumanId` becomes a nominal type on
`exportIndexMappingSchema.human_id`, with the single sanctioned cast at the `schemas.ts` parse
boundary and a cast-escape rule in `check-ordinal-write-sites.mjs`. ⛔ **BLOCKED BY Phase 1** — this
is a hard ordering, not a preference: landing the brand while `:743` still returns
`formatDocDisplayId`'s plain `string` makes `bun run typecheck` red by construction, so AC-MIS-6
cannot go green until Phase 1 is merged.

**Phase 3 — `readonly` (AC-MIS-5).** D5: assert `runCheck` reports drift and writes nothing, driven
against a throwaway corpus. Touches only a new test file, so it runs CONCURRENTLY with Phase 1 — no
anchor intersects.

## Sequencing Risks

- **Phase 1 ↔ Phase 2 is a mutual green interlock, resolved by ordering.** Either half landed alone
  leaves a red: brand-first reds `typecheck`, and there is no configuration in which both are
  claimed concurrently and both oracles pass. Do not dispatch Phase 2 before Phase 1 is merged into
  `main`.
- **AC-MIS-4 edits a GREEN attested AC (AC-084-4) on SPEC-084.** Using `lore ac set` on SPEC-084
  demotes it to `draft` and hard-blocks every descendant claim; SPEC-084 is `approved` at
  `01KYF1NXCQ78C4SSJ34HKJBYAW`. Phase 1's task changes only the TEST FILE's pinned literals, not the
  AC declaration, so no demotion is expected — but re-read SPEC-084's status immediately before any
  dependent dispatch rather than trusting this note.
- **Phase 2 changes a type exported from `@lore/core`, which the dashboard imports.** The brand must
  be type-only — no runtime import may be added to the default barrel, or the dashboard SPA breaks
  at module load. A `packages/*` export change also needs the sub-package built before a dependent
  typecheck means anything.
- **Phase 2 arms a new rule tree-wide.** Budget the back-catalogue sweep and any written exemption
  inside Phase 2's own slice.

## Out of Scope

The AC-FR-10 oracle's repair-then-assert shape, the suite↔corpus mutual exclusion, and the
`spec-loop-e2e` pollution guard's narrow scope. ⛔ No task in this plan may touch
`scripts/tests/spec-mirror-export.test.ts`.
