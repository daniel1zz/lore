---
id: TASK-1379
type: task
role: plan
title: "[Skill:implement] measure an isolated helper's changes at SubagentStop in its own working copy"
status: draft
priority: high
phase: "measurement"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1371, type: blocks}
  - {id: TASK-1377, type: blocks}
  - {id: TASK-1374, type: blocks}
---
Estimate: M
Approach: assets/hooks/subagent-trail.mjs: isolated = git-common-dir != git-dir on payload cwd; base = merge-base(helper HEAD, main checkout HEAD); files = diff(base, temporary index seeded from the helper's real index + add -A) so untracked files count; paths outside the working copy excluded; each firing overwrites the measurement and ended_at and increments end_count (never touches judged_end_count); non-isolated -> measured:false reason 'not isolated'; any failure -> measured:false with reason; exit 0 and empty stdout always (D13). Writer helpers go in assets/hooks/lib/session-trail.mjs.
Source: spec Design > Helper measurement; D6.
AC: AC-ST-2.
Integration: helper records are read by the helper-scope task and by lore session trail.
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
