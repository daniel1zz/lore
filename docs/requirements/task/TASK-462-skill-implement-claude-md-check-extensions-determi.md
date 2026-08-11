---
id: TASK-462
type: task
role: plan
title: "[Skill:implement] claude-md-check extensions — deterministic reference existence plus advisory narrative smells"
status: archived
priority: medium
phase: "Phase 1: Pure Core"
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-088
plan: PLAN-088
---
Objective: extend claude-md-check.ts per spec-context-verb-family-two-zone-claude-md-anatomy-lore D6/D7 — checkReferenceExistence(content, fileExists) with kind reference_missing (deterministic), detectNarrativeSmells(content) returning separate AdvisoryFinding[] (never exit-affecting). Keep lintMemoryFiles untouched; module stays store-free and pure (predicate injected). Reference grammar: reuse/share the path normalizer with task file_anchors (SPEC-042) — do not re-implement. Green oracle: AC-CTX-2 command.
