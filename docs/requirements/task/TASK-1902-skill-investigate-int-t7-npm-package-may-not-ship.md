---
id: TASK-1902
type: task
role: plan
title: "[Skill:investigate] INT-T7 npm package may not ship assets/project/* (pre-push, reference-transaction), so a consumer's setup --project would install no hooks"
status: archived
priority: medium
phase: "Phase 1: integrate"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-238
plan: PLAN-238
links:
  - {id: TASK-1893, type: blocks}
---
Estimate: S
Approach: INT-T2 read from code that RealAssetSource excludes assets/project/ and scripts/publish-npm.ts builds its shipped list from that source + context/ + retired paths, so assets/project/* (pre-push, and now reference-transaction) may not ship in the npm package; a bare binary copy also failed to find assets/project/pre-push. Verify first: build the npm package into a temp dir (publish-npm dry run / pack) and list whether assets/project/* is present, and run `lore setup --project` from that installed package in a throwaway repo. If missing: ship them (one source list), with a test asserting every assets/project file is in the packed tarball.
Source: INT-T2 report 2026-10-18
AC: packed package contains every assets/project file; setup --project from the packed install installs the hooks (byte-identical).
