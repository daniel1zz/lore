---
id: TASK-1699
type: task
role: plan
title: "Land BR-1346 holder scope alone: a holder holds what its own change touched; directory anchors hold only changed files"
status: draft
priority: critical
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PRD-001
---
BR-1346 as landed counts every declared anchor of every unarchived, unlanded task as held, so directory anchors (packages/lore/tests/, scripts/tests/) and paused whole-file anchors block landings across sessions. Measured 2026-10-20: D3b-A was refused, and lore-81's worktree-agent-ab021305af8e0f71f was refused for test files the holder never touched. The corrected semantics (BR-1346 modify in spec-landing-does-the-bookkeeping-claims-start-from-main-parked) are implemented in commit 55a1120c on worktree-agent-a3a13cd12b9cdda37 (D3b-B), but that branch waits behind D1-1. This task ports only the holder-scope change onto main, without the park verb, so the parked-state checks are left out until D3b-B lands.
