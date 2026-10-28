---
id: TASK-1239
type: task
role: plan
title: "[Skill:implement] AC write chokepoint + actor provenance on AC writes"
status: archived
priority: critical
phase: "Phase 1: Write paths"
created: 2026-10-08
updated: 2026-10-25
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1236, type: blocks}
  - {id: TASK-1233, type: blocks}
---
Estimate: L
Approach: one service function applyAcChange(spec,before,after,actor) that every write changing extra.acceptance_criteria passes through; CorpusService.create/set call it when the AC array differs (byte comparison of the canonical JSON); AcService verbs call it as the sanctioned path; refusal code AC_WRITE_NOT_VIA_AC_VERB; AC audit/version rows take the resolved actor
Source: spec C3 + security review (mcp/tools.ts:169 comment, corpus-service.ts:1516 create path); slice-1 DEDICATED_EXTRA_KEYS replace guard pattern
Covers: AC-BLS2-1
AC:
- Before editing: run AC-BLS2-1's command and record expected-fail on THIS task
- bunx vitest run packages/lore/tests/unit/service/ac-write-chokepoint.test.ts passes (Tests N passed)
- Scoped oracle: bun run test:changed plus every test importing corpus-service.ts or ac-service.ts is green
- No AC write path left that bypasses the chokepoint: the command `grep -rn "acceptance_criteria" packages/lore/src --include=*.ts | grep -vE "ac-write-chokepoint|ac-service|ac-citations|tests?/|\.d\.ts|//|\*"` lists no write site (output reviewed and pasted into the evidence tail)
