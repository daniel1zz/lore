---
id: TASK-260
type: task
role: plan
title: "[Skill:review] Cutover verification + docs + code anchors"
status: archived
priority: critical
phase: "Phase 4: Cutover verification"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
---
Estimate: M
Approach: run migration --dry-run against a COPY of the live corpus (never live .lore/, invariant); both runners; lore verify <this plan> for attested ACs; update root+service CLAUDE.md SPEC-056 entries; declare spec code anchors post-landing (lore anchor add)
Source: plan Exit Criteria; DoD 8
Dimensions: D-FUNC, D-DOC
Scope-Alt: none
Covers: AC-P-1, AC-P-2, AC-P-3, AC-P-4, AC-P-5, AC-P-6, AC-P-7
AC:
- Given the corpus copy, When dry-run migrated, Then reconciliation diff=0 (R2 trigger check)
- Given lore verify, When run on this plan, Then all 7 SPEC-056 ACs attested pass
- Given lore status --check-drift, When anchors declared, Then exit 0
