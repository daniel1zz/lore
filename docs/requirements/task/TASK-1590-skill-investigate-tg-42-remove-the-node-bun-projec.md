---
id: TASK-1590
type: task
role: plan
title: "[Skill:investigate] TG-42 remove the Node/Bun project split: diagnose the 20 Node-only test files and move each onto the Bun runtime"
status: draft
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: L
Approach: The two-project split (vitest.node-files.ts: 20 files, many marked UNDIAGNOSED) is why AC commands can pick the wrong config and why every runner path needs routing (TG-41 adds a router as the interim end state). ADR tg-1 option (b) chose one runner = vitest on the Bun runtime; the Node project is the remaining exception. For each listed file, find why it fails under the Bun runtime (run it with bunx --bun vitest run, read the error), fix the root cause (or prove a real Node-only dependency and record it), and remove it from the list. When the list is empty, delete the Node project config and the router's Node branch. No test weakened (INV-1).
Source: peer design review 2026-10-18 (patch-shaped guards vs end state); ADR adr-tg-1-test-runner-decision-measured-comparison-of-bun-only
AC: vitest.node-files.ts lists only files with a recorded, proven Node-only reason (target: none); the full suite census still reports files on disk == files run.
