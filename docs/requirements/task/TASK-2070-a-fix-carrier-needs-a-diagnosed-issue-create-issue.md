---
id: TASK-2070
type: task
role: plan
title: "A fix carrier needs a diagnosed issue: create --issue and issue adopt refuse undiagnosed issues"
status: draft
priority: high
phase: "P3 Diagnose"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-254
plan: PLAN-254
links:
  - {id: TASK-2082, type: blocks}
---
Covers: AC-MI-6
Approach: assertDiagnosedForCarrier in issue-diagnosis-service.ts (falsifier literal 'if (diagnosis !== "mechanism") return refuseUndiagnosed(') is called where a carrier is created: create-issue-refs.ts (create plan --issue and create task --issue) and issue-adoption.ts (lore issue adopt); no tool-protocol carrier path exists (lore_create has no issue argument). Check order: number valid, in live listing, (adopt only) already adopted -> exit 0, then diagnosis != mechanism -> exit 4 (symptom-only, unstated and conflicting all refused). readDiagnosis reads the labels each listing entry already carries (github-intake-port.ts:113-121) from the one listing resolveGithubIssueListing fetches, so no extra request. Existing carriers are untouched.
Ordering: after the diagnose verb (same service file).
