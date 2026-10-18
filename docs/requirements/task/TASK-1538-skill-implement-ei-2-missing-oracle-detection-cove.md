---
id: TASK-1538
type: task
role: plan
title: "[Skill:implement] EI-2 missing-oracle detection covers script paths; not_measured regardless of prior passes"
status: draft
priority: high
phase: "Phase 1: rule and re-verification"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-203
plan: PLAN-203
links:
  - {id: TASK-1539, type: blocks}
---
Estimate: M
Approach: oracle-file-existence.ts extracts only TEST_FILE_TOKEN_PATTERN paths (~96) from segments led by vitest/bun test/bun run/playwright/dist/lore (~288-291, 382-389); unclassified segments yield [] and findMissingOracleFiles returns [] (~694) = fail-open. Extend extraction to file paths handed to an interpreter/runner (bun, node, sh, bash, tsx, bunx <tool>); count and name segments it cannot classify (AS-17) instead of treating them as clean. Remove TG-22's narrowing: deriveAcCoverageState (~744) returns not_measured whenever oracle_file_missing is non-empty, regardless of passes_ran_missing_oracle; annotateMissingOracleFiles (ac-service.ts ~1476-1510) keeps the count only as information. lore ac add/set path check covers script paths. Red-first: the 5 halves of AC-EI-2. Update TG-22's tests whose expectation encoded the narrowing, stating the spec authority (AC-TG-6 text + AC-EI-2). Remove the AC-EI-2 not-built ledger row.
Source: spec-evidence-identity-an-attested-row-counts-only-for-the AC-EI-2; spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6
Half (5): a segment the extractor cannot classify is listed in lore ac list --json as oracle_paths_unchecked and counted on the AC text line as "N segment(s) not checked". Interpreters: bun, node, sh, bash, tsx, and bunx/npx followed by bun, node or tsx.
AC: AC-EI-2 red-first then green; scoped importers of oracle-file-existence.ts and acceptance.ts green.
