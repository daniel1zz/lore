---
id: TASK-1389
type: task
role: plan
title: "[Skill:implement] F7 done: honor the attested execution root; remediation names only passing routes"
status: archived
priority: critical
phase: "Phase 1: fixes"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
links:
  - {id: TASK-1385, type: blocks}
  - {id: TASK-1381, type: blocks}
---
Estimate: M
Approach: per spec F7 — add an optional executionRoot to commandRunsFileUnfiltered and findMissingOracleFiles, joined with any cd offset from extractCdPrefixTarget; findMissingUnfilteredTestFileRuns passes each row's attestation.execution_root; rewrite the refusal remediation (task-workflow-service.ts:3572-3577) to name only passing routes (repo-root-relative command, or lore verify --execution-root). Do not parse --cwd.
Source: spec F7; packages/core/src/attestation-completeness.ts:1194-1215; packages/core/src/oracle-file-existence.ts:412,496,672; packages/lore/src/service/task-workflow-service.ts:1248-1254,3572-3577
Resolves: task-the-cwd-blind-spot-is-a-class-not-one-function-lore-done-s, task-the-oracle-file-existence-precheck-understands-only-the-cd
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-CRIT-9, AC-CRIT-10
AC:
- commandRunsFileUnfiltered('bun test tests/x.bun.test.ts','packages/lore/tests/x.bun.test.ts',{executionRoot:'packages/lore'}) is true, false without it; findMissingOracleFiles with that root reports nothing (AC-CRIT-9, @lore/core unit test)
- lore done on a task whose only test-anchor pass is a lore verify row with attestation.execution_root=packages/lore passes the unfiltered-run floor (findMissingUnfilteredTestFileRuns stays in task-workflow-service.ts, pinned by adhoc-ac-scope-floor-doc-invariants.test.ts:191); the refusal contains no self-reported '--result pass' without '--capture' and names 'lore verify --execution-root' (AC-CRIT-10, lore-side test)
Integration: lore done and lore evidence both call these @lore/core functions; rebuild packages/core before verifying packages/lore dependents.
