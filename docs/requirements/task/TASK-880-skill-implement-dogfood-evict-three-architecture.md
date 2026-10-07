---
id: TASK-880
type: task
role: plan
title: "[Skill:implement] dogfood: evict three Architecture subsections + adoption enforce in this repo"
status: archived
priority: critical
phase: "Phase 3: Dogfood & verify"
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-149
plan: PLAN-149
links:
  - {id: TASK-881, type: blocks}
  - {id: TASK-910, type: blocks}
---
Estimate: S
Owner: orchestrator on main (config/.md + corpus writes).
Blocker artifacts: the Phase-1 core task (binary must understand `adoption` before .lore/config.yaml carries it — .strict() schema, plan R1) and all Phase-2 tasks (AC-STR-8 runs the rebuilt dist/lore whose WARN/adoption surfaces they complete).
Approach: per contract Eviction Rule — move '### Dogfooding: Skill/Tool Eval Log', '### AI Default by Caller Surface (SPEC-024)', '### Implementation Status' verbatim into knowledge-reference docs (lore create knowledge --sub-type reference), leave one-line slug stubs under Architecture; then `bun run build` and add `adoption: enforce` under context.memory_files in .lore/config.yaml.
Source: spec-claude-md-root-section-structure-check-and-adoption-mode Scope; ADR
Dimensions: D-DOC
Scope-Alt: none
Covers: AC-STR-8

AC:
- `lore verify <plan> --task <this-task>` attested pass for AC-STR-8, whose declared command ends with `echo 'AC-STR-8 PASS: repo runs under adoption enforce (config) with 0 downgraded, three Architecture subsections evicted, every stub slug resolves'` (output tail must contain that line).
