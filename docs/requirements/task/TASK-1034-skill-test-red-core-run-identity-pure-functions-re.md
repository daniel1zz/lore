---
id: TASK-1034
type: task
role: plan
title: "[Skill:test] RED — core run-identity pure functions (rewrite table, claim-conflict predicate, run id derivation)"
status: archived
priority: critical
phase: "P1 Contracts"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1046, type: blocks}
---
Estimate: S
Source: spec §Public interface (rewriteBashCommand, rewriteMcpInput, stripHarnessRunFlag, hasClaimConflict, deriveRunId, HARNESS_ADAPTERS)
TDD-Role: red | Paired-Impl: `task-skill-implement-core-run-identity-module-types-harness` (core run-identity module)
Covers: AC-RID-15, AC-RID-12 (predicate half)

Scenarios:
- Given `lore claim t --by x`, When rewritten with run R, Then the result is `lore --harness-run R claim t --by x`.
- Given `cd a && lore evidence t | tail -1` and `FOO=1 lore set d`, Then each lore word at a command position gets the flag and nothing else changes.
- Given `echo "lore claim t"`, a heredoc body containing `lore`, and `echo lore`, Then the command is returned byte-identical.
- Given a command already carrying `--harness-run X`, Then X is removed and R inserted once; rewrite(rewrite(c)) equals rewrite(c).
- Given an MCP input {by:'a', harness_run:'X'}, Then rewriteMcpInput returns harness_run R and keeps by.
- Given holder {by:'a', run:R1} and claimant {by:'a', run:R2}, Then hasClaimConflict is true; claimant run R1 → false; claimant run null → true; legacy holder {by:'a', run:null, legacy:true} vs claimant by 'a' → false, by 'b' → true.
- Given sessionId S and agentId A, Then deriveRunId gives `cc:S` and `cc:S:A`; two agent ids give two different runs.

AC:
- Given the two test files exist, When `bunx vitest run packages/core/tests/run-identity-rewrite.test.ts packages/core/tests/run-claim-conflict.test.ts` runs before the module exists, Then it fails on the missing module (not on a test bug), and the failing run is recorded at once with `lore evidence <task> --result expected-fail --output-tail-file <file>`.
