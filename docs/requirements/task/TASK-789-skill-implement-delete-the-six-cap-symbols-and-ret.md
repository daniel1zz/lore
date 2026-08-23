---
id: TASK-789
type: task
role: plan
title: "[Skill:implement] delete the six cap symbols and retire the cap config key without removing it"
status: archived
priority: critical
phase: "P1: Cap removal"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-774, type: blocks}
  - {id: TASK-780, type: blocks}
---
Estimate: L
Approach: mechanical deletion of six symbols, measured at 109 case-sensitive references across packages/. The config key feedback.inbound.open_report_cap changes from `.default(OPEN_REPORT_CAP)` to `.optional()` with a warning on presence — the key is NEVER removed from the schema (Invariant 4: FeedbackConfigSchema is .strict() at three levels and .lore/config.yaml is gitignored, so a deleted key breaks a machine's whole command surface with no rollback).
Source: spec Migration Plan P1; Scope → Out ("Deleting the open_report_cap config key — ever")
Dimensions: D-FUNC, D-CODE
Scope-Alt: nothing. A partial deletion leaves a non-compiling tree (Risk PR-2), which is why this is one task and must not be split.
Covers: AC-GI-9, AC-GI-10

Symbols to delete: OPEN_REPORT_CAP, resolveOpenReportCap, countOpenReports, OpenReportCapRefusal, QUOTA_FREEING_RESOLUTIONS, listOpenAdhocDrafts.
Test files to delete (~1214 lines): the issue-cap-refusal-message, issue-cap-quota-release and issue-cap-configurable suites.

AC:
- Given a case-sensitive literal scan of .ts sources under packages/ for the six symbol names, When the deletion is complete, Then the match count is exactly 0 (AC-GI-9's oracle, exit 0)
- Given that same scan, When it runs, Then it does NOT match the surviving lowercase config key `open_report_cap` — case sensitivity is load-bearing, and both AC-GI-9 and AC-GI-10 must be green simultaneously (spec Risk R7)
- Given the anchored test file from the paired red task, When it runs, Then all four cases pass
- Given `lore report-issue` with more open reports than the former ceiling, When it runs, Then it does not refuse for quota reasons
- A FULL-REPO typecheck is exit 0 — not a scoped one (Invariant 1, Risk PR-2)
- Both test runners pass on the full suite for the touched packages
