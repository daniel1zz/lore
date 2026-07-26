---
id: TASK-175
type: task
role: plan
title: "[Skill:verify] T10 main-checkout full-suite + attested verify + assess close-out"
status: archived
priority: critical
phase: "Phase 4: Verification"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
---
Estimate: S
Source: plan Exit Criteria; executed by main orchestrator on main checkout after all merges
TDD-Role: none (verification close-out)

AC:
- bun run typecheck exit 0; bun run test (both runners) exit 0 on main post-merge (unpiped exit codes)
- LORE_ACTOR=agent:main-orchestrator lore verify <this-plan> --yes: all 10 spec ACs pass attested
- lore status --check-tree --check-drift exit 0 after declaring spec code anchors for landed files
- lore assess <plan> --diff <first-task-commit>..HEAD verdict recorded; gaps fixed or accepted in Decisions Log
