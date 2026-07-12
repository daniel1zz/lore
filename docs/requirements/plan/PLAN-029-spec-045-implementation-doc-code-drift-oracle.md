---
id: PLAN-029
type: plan
role: plan
title: "SPEC-045 Implementation — doc-code drift oracle"
status: archived
priority: high
created: 2026-07-12
updated: 2026-07-12
tags: [spec-045, drift, memory-hygiene]
parent: SPEC-049
---
Implementation plan for SPEC-045 (doc-code drift oracle, PRD §16 H3). Two serial tasks: T1 core+service (code-anchors pure layer w/ six drift kinds, DriftCheckService w/ FsProbe port + CAS RMW authoring, D6a grammar seams in CorpusService, config workflow.drift.enabled), then T2 adapters+docs (status.ts value-returning restructure + exit precedence + repair hints + armed count, anchor dispatch + --code-anchor + task # rejection, drift-flow.ts, MCP lore_status first schema + lore_anchor_set spec REPLACE + bootstrap count, renderResolvedToMarkdown projection, feeding-source advisory, CLAUDE.md). Serial worktree implementers; ABSOLUTE worktree paths for every oracle; checkpoint-commit after each coherent unit (SPEC-044 retro learning 1); composition root app.ts is explicitly in T2's anchors (SPEC-044 retro learning 4).
