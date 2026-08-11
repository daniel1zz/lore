---
id: TASK-633
type: task
role: plan
title: "[Skill:implement] FIX ordinal backfill semantics — declared-number claims preserved, not dense renumber"
status: archived
priority: medium
phase: "Phase 3: Verification + live repair"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
---
Live dry-run exposed: backfill assigns dense sequential ordinals by created_at (SPEC-027→1, 106 docs all moved), violating spec step 1 ('every numbered-type doc with a title-declared number CLAIMS IT as ordinal') and the spec's own worked example (bootstrap keeps 080, outline→081, audit-2→082, everything else unmoved). Fixture passed because its colliding-SPEC-1 case is indistinguishable between the two algorithms — missing negative case: non-colliding declared numbers preserved verbatim. Fix algorithm per orchestrator adjudication: title-declared claims (precedence 1), export-index-declared claims (precedence 2, keeps legacy SPEC-001..026/ADR-001.. in place), each cohort in created_at order, assign declared-if-free else next-free>=declared (cascade); unclaimed docs get next-free strictly above max claim (never recycle historic gaps). Report must show UNCHANGED/CHANGED split. Blocks T8 --apply.
