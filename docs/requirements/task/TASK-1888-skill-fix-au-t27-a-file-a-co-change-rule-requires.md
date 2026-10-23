---
id: TASK-1888
type: task
role: plan
title: "[Skill:fix] AU-T27 a file a co_change rule requires for an anchored file counts as covered by that anchor (manifest reported outside-anchors 3 times)"
status: archived
priority: medium
phase: "Phase 1d: apply on main"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-204
plan: PLAN-204
---
Estimate: S
Approach: Three times on 2026-10-18/19 (INT-T3, AU-T25, AU-T26) a task anchoring an assets/** file was reported "changed files outside the anchors" for packages/lore/src/generated/assets-manifest.ts — the very file the project's co_change rule (.lore/config.yaml workflow.turn_end.co_change: when assets/** require the manifest) obliges it to change. The scope review and the co-change rule contradict each other: obeying one trips the other, and the orchestrator patches anchors by hand. One rule: a file a co_change rule REQUIRES because an anchored file matched its `when` is covered by that anchor (derived from the same co_change config, no second list).
Red-first: helper anchored on assets/x.md changes assets/x.md + the manifest -> today outside-anchors for the manifest (red); after: none. Control: changing the manifest WITHOUT any anchored file matching a when glob is still outside-anchors.
Source: turn-end reviews 2026-10-18/19
AC: test green; AC-ST-7 and AC-ST-8 oracles pass.
