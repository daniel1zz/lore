---
id: TASK-267
type: task
role: plan
title: "[Skill:implement] PhaseChecklistService"
status: archived
priority: high
phase: "Phase 2: Services"
created: 2026-07-19
updated: 2026-07-19
tags: []
parent: PLAN-068
plan: PLAN-068
links:
  - {id: TASK-261, type: blocks}
---
Estimate: M
Approach: PhaseChecklistService mirroring AcService (CAS + version + audit); drop requires {by,at,reason}; manual check voiding via statement comparison
Source: spec-spec-056 D2 split + checklist bind union
Dimensions: D-FUNC, D-CODE
Scope-Alt: track verbs can land minimal (add/set-status/note) deferring list formatting to CLI task
Covers: AC-P-4
AC:
- Given T6 RED checklist suites, When implemented, Then those tests exit 0
- Given a dropped item without reason, When dropped, Then VALIDATION_ERROR (fail loud)
