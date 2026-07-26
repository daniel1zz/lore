---
id: TASK-202
type: task
role: plan
title: "[Skill:implement] vendored stanza + conformance token assertions"
status: archived
priority: high
phase: "Phase 1: Implementation"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-044
plan: PLAN-044
---
Estimate: S
Approach: locate the vendored corpus-workflow snippet SSOT in assets/ (SPEC-046 P0; grep assets/ for the governance snippet file) and append a compact reporting-discipline stanza (wording mirrors buildReportIssueHint's re-verify-first clause: suspected lore defect — false deny / wrong output / crash — re-check own input first, then `lore report-issue`); add token-presence assertions to the assets-conformance test family (find the existing conformance oracle test; add assertions that the SSOT copy contains 'report-issue' + the re-verify clause) so parity cannot vacuously pass with the stanza absent from both copies.
Source: spec-073 §Design; SPEC-046 assets SSOT
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-073-4

AC: the AC-073-4 command exit 0; the existing full assets-conformance test file green; bun run typecheck exit 0.
Integration: next `lore setup` run installs the stanza into consumer CLAUDE.md assets.
