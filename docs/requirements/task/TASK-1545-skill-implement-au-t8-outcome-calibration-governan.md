---
id: TASK-1545
type: task
role: plan
title: "[Skill:implement] AU-T8 outcome calibration, governance-loosen and the sampling floor"
status: archived
priority: high
phase: "Phase 1c: overrides, calibration, integrity"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
links:
  - {id: TASK-1543, type: blocks}
  - {id: TASK-1546, type: blocks}
---
Estimate: L
Approach: outcome observers (archive-ref restore, reopen/restore/correction/invalidate of a decided subject, reverted merge) write outcome rows; C = Wilson LB z=1.96 over last 50 outcomes + 50 pseudo-outcomes at the prior; lore autonomy set <class> (tighten auto; loosen -> governance-loosen human-always, empties the real-outcome window on accept); sampling floor: every 10th auto decision per class (sequence-number rule) queued for audit; audit answers via lore decide feed outcomes. lore calibration --stats shows outcome counts per class (BR-1005). Red-first halves of AC-AU-8 and AC-AU-10.
Source: spec-autonomy-phase-1-decision-function-human-channel-lore; decision: adr-autonomy-is-decided-by-measured-facts-one-decision-function
AC: AC-AU-8, AC-AU-10.
