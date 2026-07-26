---
id: TASK-203
type: task
role: plan
title: "[Skill:implement] hints: buildReportIssueHint + CLI error/gate seams + bun tests"
status: archived
priority: critical
phase: "Phase 1: Implementation"
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-044
plan: PLAN-044
---
Estimate: M
Approach: pure `buildReportIssueHint(errClass: "gate"|"internal"|null, upstreamConfigured: boolean): string | null` in NEW packages/lore/src/adapters/cli/report-issue-hint.ts (wording SSOT, re-verify-first clause per SPEC-073 §Design); call it from (1) the CLI's LoreError print/exit path — locate the single seam where LoreError → stderr + exit code happens (utils.ts family; investigate exact function) with errClass derived from field.startsWith("gate:") / code===STORE_ERROR-or-unexpected — and (2) commands/gate.ts blocked output. upstreamConfigured via resolveFeedbackUpstreamCfg (report-issue-wiring.ts) — no second config parse; MUST NOT slow the happy path (only consulted on error paths).
Source: spec-073 §Design; SPEC-072 report-issue-wiring.ts
Dimensions: D-FUNC, D-UX
Scope-Alt: gate.ts seam may collapse into the shared exit path if gate denials already route through it — then one seam, documented
Covers: AC-073-1, AC-073-2, AC-073-3

AC: run the three spec AC commands (bun test report-issue-hint.bun.test.ts -t AC-073-1/2/3), each exit 0 ≥1 matched; bun run typecheck exit 0; existing gate-output snapshot/regression tests untouched and green (scoped: any test file matching gate in packages/lore/tests).
Integration: hint visible to any consumer with feedback.upstream configured on gate-deny/internal-error stderr.
