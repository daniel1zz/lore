---
id: TASK-1393
type: task
role: plan
title: "[Skill:implement] F2 assess: findings on files the judge never saw are unverifiable, not scored"
status: archived
priority: critical
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1384, type: blocks}
  - {id: TASK-1381, type: blocks}
---
Estimate: M
Approach: per spec F2 — pass the WHOLLY omitted file set as its own field from the code that renders the Truncation Manifest (assess-template.ts:721-729; headTruncatedFile at :724 counts as shown) into _finalizeAssessment; before verifyFindingPaths move every finding whose paths[] intersects it to unverifiable_findings with reason 'not-shown-to-judge'; add reason to unverifiableFindingSchema (packages/core/src/assessment.ts:452) and a separate not_shown count (path_verification.unverifiable keeps meaning 'absent at the commit').
Source: spec F2; packages/lore/src/ai/assess-template.ts:721-729; packages/lore/src/service/ai-provider-service.ts:361-402, 668-730, ~1942
Resolves: task-lore-assess-scores-findings-against-files-listed-in-its
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CRIT-3
AC:
- Given truncated[] = ['diff:src/a.ts'] and a MAJOR finding on src/a.ts that exists at the commit, When finalized, Then it is in unverifiable_findings with reason not-shown-to-judge, counted in not_shown (not path_verification.unverifiable), and absent from typed_gaps; a finding on a shown or head-truncated file stays in typed_gaps (AC-CRIT-3)
Integration: lore assess stores and prints the finalized assessment; the moved finding is visible under the existing unverifiable section of lore assess output.
