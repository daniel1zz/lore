---
id: TASK-1979
type: task
role: plan
title: "[Skill:corpus] Supersede approved criteria whose command names a deleted MCP test"
status: archived
priority: critical
phase: "Phase 3: Reconcile the corpus"
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-246
plan: PLAN-246
links:
  - {id: TASK-1959, type: blocks}
  - {id: TASK-1969, type: blocks}
  - {id: TASK-1964, type: blocks}
---
Estimate: L
Approach: main agent, corpus commands only. For each approved spec criterion whose command names a test file or test case T6 deletes, run `lore ac supersede <spec> <AC-ID> --by spec-remove-the-lore-mcp-server:AC-RMCP-1 --reason "lore MCP server removed (adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only)"` (supersede does not demote the spec; if `lore get <spec>` nevertheless shows draft afterwards, run `lore review` + `lore approve` for it in the same session). Criteria whose test file is only EDITED (AC-046-A, AC-RID-15, AC-RID-16) are amended by T7b, not superseded here. Skip every doc owned by lore-81 (Invariant I5: AC-RL-2, AC-DR-2, AC-DR-4).
Source: corpus map of 2026-10-27.
Dimensions: D-CORPUS
Scope-Alt: none (Invariant I4: this task blocks T5 and T6a, the first tasks that delete a test file)
Covers: (supporting AC-RMCP-1; Invariant I4)

Criteria (spec id → AC): 01M0SPBEKB invalidate the whole spec (its premise is the MCP copy; `lore invalidate --superseded-by spec-remove-the-lore-mcp-server`); 01M4ZNED7P AC-CV-8; 01M4ZDKPR3 AC-TE-6; 01M5TZNKAR AC-RV-6; 01KX704CSP AC-SL-6; 01KX7CC5PQ AC-S3-8; 01KX7WM8WE AC-MH-9; 01KXAJ9Z74 AC-SP-7; 01KXB08CEE AC-DR-5; 01KXX8F1RT AC-V-7; 01KY7PVW0P AC-070-8, AC-070-9, AC-070-15, AC-070-16; 01KZRH1WKS AC-RR-9; 01M0SVMCPH AC-GR-11; 01M59HK97W AC-GS-15; 01M4NCPS9M AC-SI-9; 01KY1N7KVW AC-061-17; 01M5KTG42H AC-LG-4; 01KZSTGA18 AC-CP-5; 01M5TZBTJG AC-ND-8. Re-check each with `lore ac list <spec>` before acting (state may have moved).

AC:
- For every spec above, `lore ac list <spec>` shows the listed criteria superseded, and `lore get <spec>` shows status approved again.
- After `bun run mirror:export`, `git grep -nE "tests/unit/adapters/mcp-|tests/integration/mcp/|mcp-tool-count|harness-run-any-server-name" -- docs/requirements/spec` matches only superseded criteria and lore-81's AC-RL-2 (reported to lore-81).
