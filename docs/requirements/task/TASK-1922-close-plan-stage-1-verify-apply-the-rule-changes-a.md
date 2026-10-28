---
id: TASK-1922
type: task
role: plan
title: "Close plan stage 1: verify, apply the rule changes, anchors, assess"
status: draft
priority: high
phase: "P3 Shipped text and plan close"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-2090, type: blocks}
  - {id: TASK-2083, type: blocks}
---
Covers: AC-DCS1-25 and the plan close. Kind: corpus (no file changes). Approved only after J5, with the new binary (set its kind first: `lore set <task> --kind corpus`); its contract then holds AC-DCS1-25 and `corpus:files-unchanged`. Precondition, true by construction: every other task of the plan except J5 is archived: R1 to R8, A to I and K by the one `lore integrate integration/done-contract-stage-1` (each recorded its red, its attested pass and its whole-file runs under today's rules), J1 to J3 by the orchestrator's old-binary `lore done --declare-no-new-tests` calls right after it, J4 earlier; J5 by its own `lore finish` and `lore done`.
TDD-Role: none
Steps (orchestrator, shared checkout, new binary; do not run `bun run build` here, it replaces the `lore` on PATH): `git checkout --detach main` if HEAD is behind; `lore verify` the plan and the specs of both foreign-criteria lists of the spec (the corrected ones and the re-verified ones; AC-DCS1-25 fails here, which is expected: it cites no changed rule); `lore rule apply spec-done-contract-compiled-at-approve-task-kinds-write-sets` (13 modifies, 4 adds); `lore anchor add` on the spec for `core/src/done-contract.ts` and the five new files under `service/` (`done-contract-compile.ts`, `done-contract-service.ts`, `task-start-service.ts`, `task-finish-service.ts`, `done-contract-migration-service.ts`); `lore assess`; then `lore finish` of this task, whose oracle AC-DCS1-25 now passes because the apply made BR-1487 live, and `lore done`; set the plan archived. This task blocks the first tasks of the #414 and #420 plans.
Done when: AC-DCS1-25 passes, `lore status --check-drift` reports no drift for the spec, assess runs, and the plan is archived.
