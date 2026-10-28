---
id: TASK-2067
type: task
role: plan
title: "[test] Compiled-binary e2e: working-state writes add no snapshot"
status: approved
priority: medium
phase: "Phase 4: Verify"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-258
plan: PLAN-258
---
Estimate: S
Approach: compiled-binary e2e in the pattern of existing packages/lore/tests/e2e/*-compiled.bun.test.ts files.
Source: spec AC-HC-7.
Covers: AC-HC-7

## Work
- e2e test against dist/lore in a mkdtemp corpus as AC-HC-7 states.

## AC
- AC-HC-7 command passes, red first (run before T2a's landing would be red; record the red against a build with isContentChange forced true if the base already contains the change).
