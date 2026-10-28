---
id: TASK-2031
type: task
role: plan
title: "P9 plan close reads grouped issue coverage from the link record, not titles"
status: archived
priority: medium
phase: "P"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-268
plan: PLAN-268
---
Resolves #352.

The plan-close gate (BR-1372, packages/lore/src/service/gate-predicates.ts) still requires one open issue per failed dimension whose TITLE names the dimension in the old per-plan format. P2/P5 file grouped issues linked to every plan sharing a fingerprint. Make the gate read coverage from the issue link's own record: a failed dimension is covered when an OPEN issue linked to the plan carries that dimension in its fingerprint record (dimension + fingerprint stored when the batch files or links it). No title parsing. Update the gate's refusal text accordingly (it must not tell the reader to use a title format). The close audit still records "accepted with known defects: #n...".

Live repro: audit row 73162 on main 2ec2b0b7, plan-the-approval-judge-rejects-patch-shaped-designs, stage close, MILESTONE_REVIEW_FAILED although #351 (regression) and #350 (correctness_vs_acs) were filed and linked.

Tests (plan-progress.test.ts, AC-PCR-4 title): a failing plan whose two failed dimensions are covered by two grouped issues (one also linked to another plan) is archived as accepted with known defects; a dimension with no linked open issue still refuses with exit 4 and BR-1372; a closed linked issue does not count.
