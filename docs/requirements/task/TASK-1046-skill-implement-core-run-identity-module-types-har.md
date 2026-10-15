---
id: TASK-1046
type: task
role: plan
title: "[Skill:implement] core run-identity module — types, harness registry, run id derivation, claim-conflict predicate, rewrite functions"
status: archived
priority: critical
phase: "P1 Contracts"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1030, type: blocks}
  - {id: TASK-1045, type: blocks}
  - {id: TASK-1035, type: blocks}
---
Estimate: M
Approach: per spec D2, D6, D9, D10 and §Public interface; pure, browser-safe (no node builtins — packages/core/src/CLAUDE.md); zod for the RunRecord schema; command-position detection with quote/heredoc skipping, no new dependency (plan Decisions log)
Source: spec-run-identity-slice-1-harness-attested-runs-attested §Module design
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — every command position in AC-RID-15 is required
Covers: AC-RID-15 (and the predicate half of AC-RID-12)

AC:
- Given the RED tables of `task-skill-test-red-core-run-identity-pure-functions-rewrite`, When `bunx vitest run packages/core/tests/run-identity-rewrite.test.ts packages/core/tests/run-claim-conflict.test.ts`, Then every row passes and the output shows `Tests N passed` with N equal to the number of test cases in the two RED files (at least 12), and 0 skipped.
- Given `bun run typecheck`, Then exit 0 and `@lore/core` exports the public names from §Public interface.
- Given the browser-safety test (`packages/core/tests/browser-safety.test.ts`), Then it still passes (no node builtin imported).
Exports (from `@lore/core`): RunId, NameSource, InvocationIdentity, WriteContext, HarnessAdapter, HARNESS_ADAPTERS, CompositionRecord, RunRecord, runRecordSchema, deriveRunId, ClaimParty, ClaimHolder, ClaimDecision, hasClaimConflict, rewriteBashCommand, rewriteMcpInput, stripHarnessRunFlag, HARNESS_RUN_FLAG.
