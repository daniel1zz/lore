---
id: TASK-076
type: task
role: plan
title: "V5 verify-dogfood: full oracles + lore verify self-acceptance + docs"
status: archived
priority: critical
phase: "verify-dogfood"
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-019
plan: PLAN-019
---
Objective: whole-feature verification + the closing dogfood: lore verify executes SPEC-039's own 12 structured ACs, producing attested evidence that validates attestation itself. ACs: AC-VRF-11, AC-VRF-12 + all-AC attested coverage.
Work (main agent):
1. Full oracles: bun run typecheck; bun run test (both runners) — record as evidence.
2. lore verify plan-spec-039-implementation-trusted-runner --task <this V5 task>: runs every script AC of SPEC-039; expect attested pass on all runnable ones (AC-VRF-5/6 bun tests included — verify runs them via their commands). lore ac list shows ⚑✔ on all 12.
3. Module CLAUDE.md sweep (core/service/cli/mcp/ai) + root CLAUDE.md SPEC-039 index line + MCP tool count 23→24 mentions.
4. export-docs sync + conventional commits. lore assess PLAN-019 with the code diff as the stage gate.
Depends: V1-V4 all merged.
