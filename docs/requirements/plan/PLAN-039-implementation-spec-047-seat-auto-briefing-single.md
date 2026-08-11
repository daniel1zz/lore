---
id: PLAN-039
type: plan
role: plan
title: "Implementation — SPEC-047 seat auto-briefing (single slice)"
status: archived
priority: medium
created: 2026-07-16
updated: 2026-07-26
tags: []
parent: SPEC-047
---
Single-implementer slice: seat-briefing asset + hook worktree detection + 2 test suites. Invariants: main-checkout injection byte-unchanged (R1), fail-open everywhere. Oracle: AC-047-A/B green + typecheck; full regression (AC-047-C) run by orchestrator at merge; AC-047-D spot check post live-sync.
