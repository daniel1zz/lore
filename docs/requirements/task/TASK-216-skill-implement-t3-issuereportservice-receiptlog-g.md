---
id: TASK-216
type: task
role: plan
title: "[Skill:implement] T3 IssueReportService + ReceiptLog (GREEN vs T2)"
status: archived
priority: critical
phase: "Phase 2: Implementations"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-045
plan: PLAN-045
links:
  - {id: TASK-214, type: blocks}
---
Estimate: M
Approach: per spec SPEC-072 §4 Public Interface + §5 check sequence — IssueReportService with injected IssueReportDeps (pure orchestration; loadUpstreamConfig/probe/openUpstream/receipts/loreVersion/reporterProject/now), 9-step fail-loud order, zero writes before createDraft success; ReceiptLog per JsonlTelemetry write pattern (mkdir -p + appendFileSync, JSON per line; read side skips+counts corrupt lines). import type ONLY from flows.
Source: spec-072-upstream-issue-reporting-lore-report-issue-consumer §4/§5; RED suite from paired test task
Dimensions: D-FUNC, D-CODE
Scope-Alt: list() live-join can degrade to receipt echo (status column deferred) if upstream read shape blocks — descope requires plan note, not silent
Covers: AC-072-7, AC-072-13

AC:
- Given the T2 RED suites, When bunx vitest run packages/lore/tests/unit/service/issue-report-service.test.ts packages/lore/tests/unit/service/receipt-log.test.ts, Then exit 0 with 2 matched files (all RED scenarios GREEN).
- Given -t 'AC-072-7' and -t 'AC-072-13' filters, Then matched test count ≥1 each, exit 0.
- bun run typecheck exit 0; bun run test:vitest exit 0 (no bun:sqlite leak into vitest graph).

Integration: service consumed by T5 CLI/MCP wiring; not user-reachable until T5.
