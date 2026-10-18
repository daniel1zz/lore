---
id: TASK-1570
type: task
role: plan
title: "Implement AC-SMM-1..3: site-only map keeps approval; owned-by checked at map and coverage time"
status: archived
priority: medium
phase: "P1-implement"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-207
plan: PLAN-207
---
Red-first. Write the three AC test files first, run them, record expected-fail evidence; then implement: (1) RuleService.setSiteMap skips demoteIfApproved when the change has no command add/remove (still one version + one audit baseline-map); (2) owned-by exclusion grammar parsed and validated at map time (leaf exists and is a leaf, not the mapped leaf, >=1 BR id, every id a live rule of that leaf, spaced em-dash separator, non-blank reason) -> VALIDATION_ERROR, nothing written; (3) coverage treats an owned-by entry as accounted only while its owner leaf resolves to a leaf and every named id is live on it (needs a rule->leaf lookup passed into computeLeafCoverage from its callers). Governing: spec-site-map-maintenance-keeps-a-leaf-s-approval-an-owned-by; adr-mapping-a-census-site-does-not-demote-a-baseline-leaf-an.
