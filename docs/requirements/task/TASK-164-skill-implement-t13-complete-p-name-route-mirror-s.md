---
id: TASK-164
type: task
role: plan
title: "[Skill:implement] T13 complete /p/:name route mirror: search, execution, issues, pending"
status: archived
priority: critical
phase: "Phase 3: Client wave"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-163, type: blocks}
---
Estimate: M
Approach: Complete the /p/:name route mirror for the four routes T10 consciously deferred: search, execution, issues (list + detail), pending — following T10's established wrapper pattern (thin route wrapper + exported props-driven page body, see routes/p.$name.library.tsx and the LibraryPageBody/DocPageBody split) so the Route.useSearch/useParams cross-route-id binding hazard stays contained. Thread useProjectParam() through each page's apiFetch/queryKeys exactly as the already-mirrored routes do.
Source: T10 completion report "Documented scope reduction" (2026-07-25); PRD §22 F2 (ALL pages work in project context) + F3 (issue triage is a committed write surface that must follow the switch); spec-078 D5.
Dimensions: D-FUNC, D-UI
Scope-Alt: none — F2/F3 are PRD-committed; partial mirror violates R-13's write-surface equivalence for issue triage.
Covers: AC-078-7 (issue-triage write surface reachability), AC-078-8 (full-route project context)

AC:
- Given multi-project mode, When navigating to /p/:name/search, /p/:name/execution, /p/:name/issues (+ detail), /p/:name/pending, Then each renders the selected project's data through project-scoped fetches/queryKeys (component test per route asserting the project segment in active queryKeys).
- Given registry-less mode, When the original /search /execution /issues /pending routes render, Then behavior is byte-identical to pre-change (existing component tests stay green unmodified).
- Given tsc + dashboard vitest suite, Then 0 errors / all green with matched counts.
