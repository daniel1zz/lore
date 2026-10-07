---
id: KN-562
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 3 decisions + 3 next steps = 6 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | spec-context-fragments-config-driven-layered-rule-injection approved v36: 21 script ACs (AC-CF-1..21) covering PRD R-18; language SSOT = lore config (option A); SessionStart split into resume + new fragments hook@0.85 | — |
| KD2 | Project Z1 renders shipped+project layers with project config only (git-shared); cross-file override of static main fragments is refused@0.85 | — |
| KD3 | Overlaps spec-claude-md-root-section-structure-check-and-adoption-mode (its plan approved; reshapes managed block + context write gate): sequence our context-flow/setup tasks after it@0.8 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: Run /lore-plan on spec-context-fragments-config-driven-layered-rule-injection; first phase: SPEC-083 amendment (AC-CF-17) + core types/discover/select/render; check anchor overlap with the adoption-mode plan via lore ready
- NS2: Then migrate owner ~/.claude/CLAUDE.md into ~/.config/lore/context/ per the spec migration table
- NS3: Uncommitted: .claude/settings.json deny rule + SPEC-155 mirror are this slice; SPEC-154/PLAN-149/TASK-864..875/ADR-040/KN-042/KN-505/export-index mirrors come from a concurrent session - do not commit them here
