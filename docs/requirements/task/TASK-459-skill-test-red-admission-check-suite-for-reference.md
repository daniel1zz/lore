---
id: TASK-459
type: task
role: plan
title: "[Skill:test] RED admission check suite for reference existence and narrative smells"
status: archived
priority: medium
phase: "Phase 1: Pure Core"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: author the RED vitest suite for AC-CTX-2 at packages/lore/tests/unit/service/claude-md-admission.test.ts. Cover: reference_missing fires for backtick-quoted repo-relative paths absent from the injected fileExists predicate; silent for existing paths, URL schemes, tokens without slash; detectNarrativeSmells returns advisory findings (ISO-date density, status words) and NEVER alters deterministic findings or exit-relevant shape. Six-dimension coverage. MUST be red at authoring (functions absent).
