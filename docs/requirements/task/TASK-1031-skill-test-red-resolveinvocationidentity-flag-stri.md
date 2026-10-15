---
id: TASK-1031
type: task
role: plan
title: "[Skill:test] RED — resolveInvocationIdentity (flag strip, claimed sources, single deprecation warning)"
status: archived
priority: high
phase: "P1 Contracts"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1030, type: blocks}
---
Estimate: S
Source: spec D1, D8, §Public interface
TDD-Role: red | Paired-Impl: `task-skill-implement-core-node-resolveinvocationidentity-with`
Covers: AC-RID-6

Scenarios:
- Given argv `[claim, t, --harness-run, R, --by, x]`, Then identity {harnessRun R, claimed x, source flag} and the returned argv has no `--harness-run`.
- Given env LORE_ACTOR=y and no --by, Then claimed y, source env, harnessRun null; resolving three times calls the injected warn sink exactly once.
- Given neither, Then claimed null, source null, harnessRun null.
- Given `--by` and LORE_ACTOR both, Then claimed is the flag value.

AC:
- Given the test file, When `bunx vitest run packages/core/tests/run-identity-node.test.ts` runs before the module exists, Then it fails on the missing module and the red run is recorded with `lore evidence --result expected-fail --output-tail-file`.
