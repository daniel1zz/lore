---
id: TASK-1216
type: task
role: plan
title: "[Skill:implement] Completeness backfill: execution branch site maps (claim-scoped)"
status: archived
priority: medium
phase: "Phase 5: Backfill and acceptance"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1209, type: blocks}
---
Estimate: L
Approach: on main after Phases 1-4 merge, claim this task from a worktree with --corpus-scope execution; run lore baseline coverage baseline-execution; record the starting gap count in evidence; for every gap: map the site to an existing rule (lore baseline map), or add a rule (unconfirmed unless a falsifying live script-mode AC exists, per method v2) and map it, or record non-business:<reason>; if the starting gap count exceeds 60, stop after the first leaf and ask the orchestrator to split this task per leaf
Source: spec AC-BLS2-12; PRD BL-7 step 3
Covers: AC-BLS2-12
AC:
- lore baseline coverage baseline-execution exits 0
- every new rule passes the impl-detail lint; new established/observed rules have a falsifying citation
- writes carry the worktree actor: `lore log baseline-run-verification | head -5` shows the worktree agent's actor (pasted in evidence)
- Deliberately not ordered after the gate: backfill writes rules and site maps, not criteria
