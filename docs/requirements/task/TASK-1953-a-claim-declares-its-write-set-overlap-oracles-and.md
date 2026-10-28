---
id: TASK-1953
type: task
role: plan
title: "A claim declares its write set; overlap, oracles and edit-hook declarations use it (AC-DCT-12..14)"
status: deprecated
priority: high
phase: "P2 Contract, kinds and implementer verbs"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1943, type: blocks}
---
Covers: AC-DCT-12, AC-DCT-13, AC-DCT-14
TDD-Role: green
Approach: the claim record gains a write set (default: the task's anchors). The overlap predicate in gate-predicates.ts compares claim write sets, not accumulated task anchors; lore claim and lore start take repeatable --write-set; lore anchor declare appends to the claim's write set, refusing a path another live claim holds (exit 4); the pre-edit hook keeps calling anchor declare and needs no change beyond its message text unless the declare contract changes. done-contract-service restricts the anchored-test oracles to the write set's test files. The write set has no count cap; MAX_FILE_ANCHORS stays on approved anchors (spec D9a). Capability and wiring in one task: the flags are registered in the claim, start and anchor commands.
Done when: AC-DCT-12, AC-DCT-13 and AC-DCT-14 pass through the compiled binary; typecheck passes; the existing claim-gate tests selected by --changed are green.
