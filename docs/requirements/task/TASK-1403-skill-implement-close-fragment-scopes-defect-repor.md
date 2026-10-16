---
id: TASK-1403
type: task
role: plan
title: "[Skill:implement] CLOSE fragment scopes defect reports (BR-1153)"
status: archived
priority: high
phase: "Phase 1: fragment"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-191
plan: PLAN-191
---
Estimate: S
Approach: edit the report-issue bullet in assets/context/corpus-workflow-4-close.md (line 15) to add, compactly and in the fragment's English style: file only for a defect of lore itself; one root cause per report, reproducible and closable on its own, never bundled; this project's own upkeep (tests already red on the baseline, stale ledgers, oversized docs, missing anchors) goes to a plan/task, not a report. Then regenerate the repo's .claude/rules/lore-corpus-workflow-close.md via `lore context refresh` (project scope) and the embedded assets manifest via `bun run build`; grep tests for the old bullet's literal wording and update/run every hit.
Source: spec-the-shipped-close-guidance-scopes-defect-reports-lore; BR-1153
Covers: AC-ISCOPE-1
AC:
- Given the edited fragment, When the AC test runs, Then the bullet contains 'one root cause' and routes repo upkeep to plan/task, the compiled rules file equals a fresh render, and lore fragments check exits 0 (AC-ISCOPE-1)
Integration: lore setup / lore context refresh install this fragment into consumers' .claude/rules; the test reads the shipped asset, not ~/.claude.
