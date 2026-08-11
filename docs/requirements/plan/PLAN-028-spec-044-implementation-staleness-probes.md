---
id: PLAN-028
type: plan
role: plan
title: "SPEC-044 Implementation — staleness probes"
status: archived
priority: high
created: 2026-07-12
updated: 2026-07-12
tags: [spec-044, staleness, memory-hygiene]
parent: SPEC-044
---
Implementation plan for SPEC-044 (staleness probes, PRD §16 H2). Two serial tasks: T1 core+store+services (pure layer, migration-005, store contract, StalenessProbeService, probeStaleness, ValidityService port, calibration kind), then T2 adapters+docs (CLI --staleness/--list/--fail-on-candidate, MCP lore_staleness_probe, status/bootstrap visibility, CLAUDE.md). Serial worktree implementers; every oracle invocation uses ABSOLUTE worktree paths (SPEC-043 T2 cwd incident).
