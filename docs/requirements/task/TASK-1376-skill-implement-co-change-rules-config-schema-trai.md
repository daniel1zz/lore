---
id: TASK-1376
type: task
role: plan
title: "[Skill:implement] co-change rules: config schema, trail-review judgment per run and for the unknown group, invalid settings reported without stopping other judgments"
status: draft
priority: high
phase: "consumers"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1374, type: blocks}
---
Estimate: M
Approach: workflow.turn_end.co_change (list of {name, when[], require[]}, default []) in packages/core/src/config.ts inside the strict turn_end object; update the comment at config.ts:682-683 that names the hook's key scan. trail-review parses co_change through the @lore/core schema itself, NOT the CLI loader's silent fallback (adapters/cli/loader.ts:21-26); invalid settings -> result co_change {measured:false, reason naming e.g. workflow.turn_end.co_change[0].require}, exit 0, helper judgments still complete. Judge each run judged by this review plus the turn's unknown-source changes as one group. Add this repo's assets-manifest rule to .lore/config.yaml. The hook relay from the previous task carries findings and the not-measured line.
Source: spec Design > Consumers, Config failure; D8.
AC: AC-ST-7.
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4 (read its Design section and Design Decisions before starting; cite rules through the spec's ACs, never restate them). Plan invariants I1-I7 apply.
