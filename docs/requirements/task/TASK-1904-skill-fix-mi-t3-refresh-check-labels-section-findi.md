---
id: TASK-1904
type: task
role: plan
title: "[Skill:fix] MI-T3 refresh --check labels section findings by their kind, not 'ceiling:'; AC-MI-2 test asserts the exact exit of status --check-claude-md"
status: archived
priority: medium
phase: "Phase 1: module index"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-239
plan: PLAN-239
---
Estimate: S
Approach: lore assess of this plan (2026-10-18, partially_met 77) found: (1) packages/lore/src/flows/context-flow.ts check mode reuses claudeMdRefusalMessage as ceilingBreach; under enforce that message carries section findings, which refresh --check then prints labelled "ceiling:" — a dishonest label. Print each finding under its own kind (ceiling vs section_missing/section_duplicate) and exit 1 for either. (2) AC-MI-2 half (1) names `lore governance claude-md --check`, which does not exist; its test checks `lore status --check-claude-md` without asserting the exit code. The orchestrator corrects the AC text; this task makes the test assert `lore status --check-claude-md` exits exactly 0 and reports no section_missing.
Source: lore assess plan-module-index-lists-only-folders-with-a-memory-file 2026-10-18
AC: red-first test for the label (a refresh --check on an enforce project whose file lacks a required section prints that finding under its kind, not "ceiling:"); AC-MI-2 test asserts the exact exit code; AC-MI-1/2/3 oracles pass.
