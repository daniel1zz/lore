---
id: TASK-1032
type: task
role: plan
title: "[Skill:implement] remove shipped instructions that tell agents to set their identity"
status: archived
priority: high
phase: "P5 Integration and purge"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1024, type: blocks}
---
Estimate: M
Approach: rewrite every hit of AC-RID-17's measured needles (29 LORE_ACTOR lines, 30 write-command --by lines on 2026-10-11) to say identity is assigned by the agent integration; keep read filters (`feed --by`); rerender .claude/rules from assets/context with `lore context refresh`; the maintainer's user fragments (~/.config/lore/context user-04, user-17) are updated in P6 by the orchestrator, not here
Source: ADR decision 7; spec AC-RID-17
Dimensions: D-DOC
Scope-Alt: none
Covers: AC-RID-17

AC:
- Given AC-RID-17's command, When it runs from the repo root, Then it prints `AC-RID-17 PASS` (it exits 1 on today's tree — the red state).
- Given `lore fragments check`, Then no rules_drift finding for the project rules files.
- Given `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts`, Then it passes (asset parity).
- Given the landed purge, When `lore rule set BR-135 --lifecycle deprecated` is run in this task, Then BR-135 shows deprecated (superseded on landing by BR-1045).
- Integration: From a fresh `lore setup` install, reading the installed lore-implementer agent definition and the seat briefing, Then neither tells the agent to export LORE_ACTOR or to pass --by on a write.
