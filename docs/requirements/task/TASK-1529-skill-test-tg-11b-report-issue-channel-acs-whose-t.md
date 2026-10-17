---
id: TASK-1529
type: task
role: plan
title: "[Skill:test] TG-11B report-issue channel ACs whose tests left with the SQLite transport"
status: archived
priority: high
phase: "Phase 3: guards"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: ~38 missing-owner ACs of the report-issue channel whose tests were deleted with the SQLite transport (commits 8b3845b1, 9e9586dd, eb1efbff): AC-ICL-7/11, AC-DC-1/2/3/5/6/7, AC-072-*, AC-OOB-1..5, AC-IC-1/2/4/5. For each: repoint to a surviving test of the same behaviour on the GitHub transport, or rewrite the test for the current transport, or — when the behaviour was deliberately removed — retire the criterion through the spec's correction path with the removal commit as the reason. List each decision. Citation rule: if lore ac set --correction demands a cite, cite only a live rule the criterion verifies (lore rule find --text / lore rule show); if none fits, lore ac exempt with a reason naming this task. Never paste the refusal's suggested BR.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared (AC-TG-5, AC-TG-9); split of task-skill-test-tg-11-repoint-missing-oracle-paths-merge (measured on main 755267a8: 268 findings = 80 missing-owner-file + 188 unowned-ac-reference)
AC: none of these ACs names a missing file; each decision is recorded on the AC.
