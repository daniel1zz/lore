---
id: TASK-1586
type: task
role: plan
title: "[Skill:fix] IV-10 check:ambient-reads tokenizes with the TypeScript scanner (regex literal in a template flipped comment/code)"
status: archived
priority: medium
phase: "P4 migration"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-208
plan: PLAN-208
links:
  - {id: TASK-1576, type: blocks}
---
Defect found in IV-6 review, reproduced 2026-10-18: scripts/check-ambient-reads.ts hand-written blanker does not model regex literals. In packages/lore/src/adapters/cli/utils.ts:375 the regex /'/g inside a template ${...} opens a phantom string; from there comment and code regions are inverted: comment lines 493/549/552/638/641 are counted and real reads at 501/566/567/649/650 are not (ledger says 9 for that file). Fix at the mechanism: replace the blanker with the TypeScript compiler scanner (ts.createScanner, already a dependency) so comments, strings, templates and regex literals are classified by the real lexer. Add AC-IV-6 test cases: a banned token inside a regex literal, inside a template substitution after a regex containing a quote, and a real read after such a line (must be counted). Re-seed the ledger to the corrected counts; any per-file rise is an undercount correction, not a new read: list each in the commit message with before/after.
