---
id: TASK-465
type: task
role: plan
title: "[Skill:implement] setup project flow refactor to consume the shared splice"
status: archived
priority: medium
phase: "Phase 2: Capability"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: refactor computeClaudeMdCandidate per spec-context-verb-family-two-zone-claude-md-anatomy-lore D4 to consume spliceManagedSections from context-projection (single splice path). Preserve SPEC-076 D7 semantics: stub/append/section-replace + five-state planUpdate + diverged-skip. Marker constants now imported from @lore/core memory-markers. Green oracles: AC-CTX-4 command + existing setup e2e suite stays green (scoped run in worktree).
