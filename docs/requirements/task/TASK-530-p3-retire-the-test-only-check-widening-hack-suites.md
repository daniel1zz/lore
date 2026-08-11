---
id: TASK-530
type: task
role: plan
title: "P3 — retire the test-only CHECK-widening hack; suites must use the real migration path"
status: archived
priority: medium
phase: "P3 closure"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-103
plan: PLAN-103
---
## Objective

Remove the test-only SQLite CHECK-widening hack from both resolves-edge e2e suites so they exercise the REAL migration path.

## Evidence

`lore assess` flagged this as a major evidence-integrity gap, and it is correct:

- `packages/lore/tests/e2e/issue-closure.bun.test.ts` — defines `widenLinkTypeCheckForResolvesTestOnly` (line ~165) and calls it at lines ~487, ~552, ~598. Three test titles carry a literal `[KNOWN-GAP workaround]` marker, including the two that verify AC-ICL-5's `--open`/`--resolved`/`--all` partition. Written BEFORE `migration-012` existed, when a real `resolves` edge could not be written at all.
- `packages/lore/tests/e2e/issue-closed-state.bun.test.ts` — line ~131 DUPLICATES the same helper ("duplicated rather than imported", per its own comment) and calls it at ~340. This suite was written AFTER `migration-012` landed, so the hack is now actively spreading rather than being retired.

Consequence: AC-ICL-5's core claim — computed resolution shown correctly in the listing — was attested against substitute state, not against genuine `resolves` edges. If `migration-012` itself were wrong, neither suite would notice.

## Deliverables

- Delete `widenLinkTypeCheckForResolvesTestOnly` from BOTH files and every call site. `migration-012` (merged) widens `links.link_type` to accept `"resolves"` on the real path — the suites must go through it.
- Remove the now-false `[KNOWN-GAP workaround]` markers from test titles and the module-header comments describing them.
- Verify the suites still pass. If any test only passed BECAUSE of the hack, that is a real defect in the migration or in `CorpusService.link` — STOP and report it; do not restore the hack and do not weaken the assertion.

## Acceptance Criteria

AC-ICL-12. Oracle: `cd packages/lore && bun test tests/e2e/issue-closure.bun.test.ts tests/e2e/issue-closed-state.bun.test.ts && ! grep -rq widenLinkTypeCheckForResolvesTestOnly tests/`

Both halves matter: the suites pass AND the helper is gone. Run `bun run build` first (both suites spawn `dist/lore`).

Also re-confirm the ACs these suites carry are still green: AC-ICL-3, AC-ICL-4, AC-ICL-5, AC-ICL-10.

## Constraints

- Throwaway corpora only. NEVER write to this repo's own `.lore/`.
- Do not touch source outside the two test files — the production path is already correct.
- Six-dimension coverage must survive the edit; you are removing a workaround, not test cases.
