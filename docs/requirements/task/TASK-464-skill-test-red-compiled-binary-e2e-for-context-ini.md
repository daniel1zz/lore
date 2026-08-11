---
id: TASK-464
type: task
role: plan
title: "[Skill:test] RED compiled binary e2e for context init and refresh verbs"
status: archived
priority: medium
phase: "Phase 2: Capability"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: author the RED bun e2e for AC-CTX-3 at packages/lore/tests/e2e/context-verbs-compiled.bun.test.ts (compiled-binary pattern per governance-claude-md-compiled.bun.test.ts — bun run build FIRST, standing lesson: stale dist). Temp repo via mkdtemp: init without provider exits 0 + skeleton + stderr warning; immediate refresh byte-identical; hand-edit inside managed section then refresh reports diverged_skip and bytes untouched. MUST be red (verb absent).
