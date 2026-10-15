---
id: TASK-1037
type: task
role: plan
title: "[Skill:implement] get/log attested · claimed rendering + AttributionReport in status --json"
status: archived
priority: high
phase: "P3 Write surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1024, type: blocks}
---
Estimate: M
Approach: per spec D4, D9 — renderers read versions.harness_run and the author field; AttributionReport.share(windowDays, clock) over countAttributedWrites; added to the status envelope next to the existing enumerators
Source: code map: get.ts:207, log.ts:68, status.ts envelope :1855
Dimensions: D-FUNC, D-UX (wording validated in X3b)
Scope-Alt: `lore list` author column may follow in a later slice
Covers: AC-RID-9, AC-RID-11

AC:
- Given `cd packages/lore && bun test tests/integration/cli/attribution-render.bun.test.ts` and `... status-attribution-share.bun.test.ts`, Then each passes.
- Integration: From an existing corpus, performing `lore log <any doc>`, Then every row reads `attested: unattested · claimed: <name>` before rollout data exists.
