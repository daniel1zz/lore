---
id: TASK-1377
type: task
role: plan
title: "[Skill:implement] lore run tasks and the trail-review helper-scope judgment, each helper end judged once by the turn-end review"
status: archived
priority: critical
phase: "consumers"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1376, type: blocks}
  - {id: TASK-1374, type: blocks}
---
Estimate: L
Approach: (1) lore run tasks <run-id> --json in commands/run.ts + run-service.ts: queryAudit({action:'claim'}) rows whose details.harness_run equals the run (they survive release and archival), then each task's current file_anchors; an unknown run id -> exit 4 naming it. (2) lore session trail-review --turn <id> --json in commands/session.ts: helpers with end_count > judged_end_count; helper files = measured changes U edit records naming the helper; coverage via anchorsOverlap (packages/core/src/file-anchors.ts), no new matcher; findings: outside anchors, outside its working copy, changes without a claimed task; none without .lore/. (3) stop-turn-review.mjs: spawn trail-review only when an unjudged helper end exists or the co_change key is present (readYamlScalar presence only); relay findings into the single block; after helper judgments complete set judged_end_count = end_count; on non-zero exit or timeout mark nothing judged and print one not-measured line naming the unjudged helpers; exit 0.
Source: spec Design > Consumers, Judging each helper end once, Spawn gating, Run -> tasks; D7, D8, D9.
AC: AC-ST-8, AC-ST-9, AC-ST-10 (co_change key presence only; the co-change judgment itself is the next task).
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
