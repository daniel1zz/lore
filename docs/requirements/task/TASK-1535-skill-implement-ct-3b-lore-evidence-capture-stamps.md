---
id: TASK-1535
type: task
role: plan
title: "[Skill:implement] CT-3b lore evidence --capture stamps like verify; lore init arms"
status: archived
priority: high
phase: "Phase 2: implement"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-202
plan: PLAN-202
links:
  - {id: TASK-1526, type: blocks}
---
Estimate: M
Approach: CT-3 (merge 89945c3d) implemented arming via `lore audit arm --confirm` but did NOT make `lore init` arm, although the corrected AC-CT-3 says a fresh corpus is armed at init. Measured reason: `lore evidence --capture` runs a command but writes no state_stamp, so in an armed corpus every captured row would read `unbound` and be refused. Fix at the root: the capture path takes the same pre/post stamp reading as `lore verify` (decideStampOutcome in verify-runner-service.ts — reuse it, one implementation), writing state_stamp or stamp_unbound_reason exactly as verify does; then `lore init` writes the arming row (with the R13 report, which is zero rows on a fresh corpus). Existing corpora keep arming by `lore audit arm --confirm` after reading the report. Red-first: (1) in a fresh `lore init` corpus, a captured pass on a committed clean tree is stamped and accepted by lore done; (2) a captured pass on a dirty tree is unbound/dirty_tree and refused; (3) `lore init` leaves exactly one state-binding-armed row.
Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-3 (as corrected 2026-10-17)
AC: AC-CT-3's init clause holds; captured evidence is stamped like verify's.
