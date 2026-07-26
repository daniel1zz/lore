---
id: TASK-165
type: task
role: plan
title: "[Skill:implement] T10 switcher + project identity + badges + /p/:name routing"
status: archived
priority: high
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
Approach: Router: wrap existing routes under /p/:name/* (registry-less keeps current paths; multi-mode / redirects to cwd-project-if-registered else localStorage last-viewed else first entry). Components: ProjectSwitcher dropdown (data from GET /api/projects via factory; error entries rendered with named diagnosis, never dropped); per-project pending count badge (client N-calls via factory); persistent project identity label adjacent to adjudication/save/config write controls (R-13 clause). localStorage last-viewed write on switch.
Source: spec-078 D5+D7; PRD §22 F2; T9 factory.
Dimensions: D-UI, D-FUNC
Scope-Alt: pending badges can degrade to lazy-load on dropdown open if N-call cost annoys.
Covers: AC-078-7 (component-test half), AC-078-8 (switch behavior half)

AC:
- Given a component test with a problem registry entry, When the switcher renders, Then the entry shows as an explicit error state with its diagnosis (never omitted).
- Given a component test of the adjudication bar and editor save controls in project context, Then the selected project's name is asserted visible adjacent to each write control.
- Given a switch A→B in component/e2e context, Then all route-level queries re-key (project segment in every active queryKey).
- Given tsc --noEmit + lint, Then clean.
