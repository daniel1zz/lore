---
id: TASK-074
type: task
role: plan
title: "T2 adapters: oracle enum consolidation + evidence --ac + MCP ac_ref"
status: archived
priority: high
phase: "service-cli"
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-018
plan: PLAN-018
links:
  - {id: TASK-070, type: blocks}
---
Objective: consolidate the 3 oracle-enum copies onto ORACLE_KINDS and expose ac_ref on both evidence write surfaces.
Spec: SPEC-038 §4, §6 (MCP half), §7 D3. ACs covered: AC-ACODE-8, AC-ACODE-3 (adapter half).
Work:
1. packages/lore/src/adapters/cli/commands/evidence.ts — VALID_ORACLES := ORACLE_KINDS import (delete local copy); add --ac <id> flag → ac_ref.
2. packages/lore/src/adapters/mcp/tools.ts — EVIDENCE_ORACLE_ENUM := z.enum(ORACLE_KINDS) (delete literal copy); lore_evidence_add gains optional ac_ref param (documented: requires by; validation happens in service).
3. Tests: CLI flag parse → service call arg; MCP schema accepts/roundtrips ac_ref; grep-oracle AC-ACODE-8 (single enum definition site).
Oracle: bun run typecheck + bunx vitest run (affected) + cd packages/lore && bun test (affected .bun.test).
Depends: T1 (ORACLE_KINDS export). File anchors: packages/lore/src/adapters/cli/commands/evidence.ts, packages/lore/src/adapters/mcp/tools.ts, matching test files. No overlap with T3 anchors.
