---
id: TASK-1485
type: task
role: plan
title: "[Skill:implement] TG-10 verify records a missing oracle file as not measured; done refuses"
status: archived
priority: high
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: In lore verify, a script AC whose command names a test file that does not exist is recorded as not measured with the missing path (never pass or fail). The AC state renderers (check:ac-state-renderers lists them) stop rendering an earlier attested pass as passing once the owning file is gone. lore done (task-workflow-service.ts, the check chain from about :3404) refuses with exit 4 naming the AC while a covered AC's oracle file is missing. Today the path is checked only at write time (ac-service.ts:249 fileExists, AC-OX-4). Red-first in a throwaway corpus.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-6.
