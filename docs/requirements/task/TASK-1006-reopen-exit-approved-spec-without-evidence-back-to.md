---
id: TASK-1006
type: task
role: plan
title: "Reopen exit: approved spec without evidence back to draft (CLI + MCP)"
status: archived
priority: medium
phase: "exits-and-surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-160
plan: PLAN-160
links:
  - {id: TASK-1003, type: blocks}
  - {id: TASK-1004, type: blocks}
---
Covers: AC-DR-4. Spec: spec-documents-are-living-or-records-a-locked-record-is-never D5, D18, BR-1050, BR-1054. ReviewService.reopen(specId, reason, seams?): refuse non-spec, empty reason; evidence count through the SAME AC-coverage query ac-service uses for plan-member AND ad-hoc governed tasks (ac-service.ts ~986/~1023) — no second query; status write via isReopenTransition (never via VALID_TRANSITIONS); count AGAIN after the status write (seam afterStatusWrite for the test); if evidence appeared: leave draft, exit-4 class error naming it, NEVER write approved back. RecordLockService becomes a required ReviewService constructor dependency (app.ts). CLI lore reopen <spec> --reason (register in cli/index.ts); MCP lore_reopen in tools.ts. Add the 'or reopen it (lore reopen) when it has no evidence' clause to the record-edit feed() in checkpoint-registry.ts. Red-first, expected-fail evidence at the red run.
