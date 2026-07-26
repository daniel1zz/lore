---
id: TASK-289
type: task
role: plan
title: "enforcer feed embedding + spec-create enrichment + tests"
status: archived
priority: medium
phase: "P1-impl"
created: 2026-07-17
updated: 2026-07-17
tags: []
parent: PLAN-035
plan: PLAN-035
---
## Task
Per SPEC-049 D1-D3: (1) gate-enforcer.ts enforce() blocked path renders checkpointRegistry[checkpoint].feed(ctx, failures) and appends to LoreError.message after a blank line; code/field/value unchanged. (2) corpus-service.ts _createImpl spec path pre-fetches findFeedingSkill and threads ruleSource/ruleMarkdown/parentMarkdown into GateContext when gate enabled. (3) Tests: enforcer per-checkpoint pack embedding incl. anchor-overlap recovery command; corpus-service enrichment found/absent; update exact-message assertions. Oracles: AC-049-1..3.
