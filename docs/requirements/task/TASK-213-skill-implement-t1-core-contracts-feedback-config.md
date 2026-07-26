---
id: TASK-213
type: task
role: plan
title: "[Skill:implement] T1 core contracts: feedback config schema + issue-report pure fns + LATEST_SCHEMA_VERSION"
status: archived
priority: critical
phase: "Phase 1: Contracts"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-045
plan: PLAN-045
links:
  - {id: TASK-212, type: blocks}
  - {id: TASK-215, type: blocks}
---
Estimate: M
Approach: per spec SPEC-072 §Public Interface — extend LoreConfigSchema with optional strict `feedback.upstream.{corpus_path,root_prd}` (mirror SyncConfigSchema nesting precedent, config.ts:403-449); new packages/core/src/issue-report.ts with pure fns matchRootPrd / countOpenReports / buildIssueReportExtra + IssueReportPayload type + OPEN_REPORT_CAP=10; export LATEST_SCHEMA_VERSION from sqlite-store.ts beside the migration chain (value = highest migration number, currently 6). All browser-safe (no Node builtins in core barrel).
Source: spec-072-upstream-issue-reporting-lore-report-issue-consumer §4 Public Interface
Dimensions: D-FUNC, D-CODE
Scope-Alt: none (contracts are the foundation; nothing descoppable)
Covers: (foundational — enables AC-072-1..13; direct evidence via core unit tests)

AC (each group bound to a named -t filter; zero-match = fail):
- feedback-schema: bunx vitest run packages/lore/tests/unit/core/issue-report.test.ts -t 'feedback-schema' exit 0, matched ≥2 (valid parse + strict unknown-key reject).
- matchRootPrd: same file -t 'matchRootPrd' exit 0, matched ≥3 (slug match, id match, mismatch/null carrying found).
- countOpenReports: same file -t 'countOpenReports' exit 0, matched ≥2 (10-of-mixed count + ids exact set).
- schema-version: same file -t 'LATEST_SCHEMA_VERSION' exit 0, matched ≥1 (equals highest migration number; imported via a type-only-safe seam if needed for vitest reachability — constant re-export must not drag bun:sqlite into the vitest graph: define the constant in a pure module store/schema-version.ts re-exported by sqlite-store.ts).
- Whole file: bunx vitest run packages/lore/tests/unit/core/issue-report.test.ts exit 0 with 1 matched file; bun run typecheck exit 0.

Integration: consumed by T3 (service), T4 (flows); no user-facing surface yet.
