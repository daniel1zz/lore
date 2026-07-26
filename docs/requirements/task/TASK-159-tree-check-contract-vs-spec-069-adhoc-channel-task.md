---
id: TASK-159
type: task
role: plan
title: "Tree-check contract vs SPEC-069 adhoc channel: task-under-prd flagged misplaced by design"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Estimate: S

lore status --check-tree exits 3 on every adhoc task (SPEC-069 parents planless tasks to the root PRD BY DESIGN — 10 such tasks today, incl. issue reports) plus legacy orphan knowledge docs. The tree contract (lore.tree.yaml / TreeCheckService) predates the adhoc channel and now permanently arms the pre-push gate with false positives, training humans to bypass with --no-verify (normalization-of-deviance risk).

AC:
- Given the tree contract updated to admit task-under-prd for tasks carrying the adhoc marker (extra.issue_report or planless adhoc), When lore status --check-tree runs on this corpus, Then adhoc tasks produce zero misplaced findings while a genuinely misparented task (spec under task) still exits 3 — both asserted by unit tests on TreeCheckService.
- Given legacy orphan knowledge docs, Then they are triaged separately (reparent or invalidate), not blanket-allowed by the contract change.
