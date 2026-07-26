---
id: TASK-190
type: task
role: plan
title: "Fix live SPEC-042 regression: apiGetReady types /api/ready as flat ReadyRecord[] but server returns ReadyReport object (home-page render TypeError)"
status: archived
priority: high
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Discovered during SPEC-077 T2 (2026-07-25). Server truth: handleGetReady returns jsonOk(taskWorkflowService.ready(...)) = ReadyReport {records, sessions, anchor_conflicts} since SPEC-042 (ready-route.bun.test.ts asserts body.data.records). Client lie: apiGetReady (api.ts ~546) types fetchJson<ReadyRecord[]> — consumers ActivePlansPanel.PlanReadinessSummary (records.filter/records.length on the OBJECT -> render TypeError; length===0 is undefined===0 -> falls through to .filter) and PlanExecution (same pattern + readyByTaskId Map over .map). Component tests likely mock the stale flat shape, and e2e passes vacuously (verify why while fixing — document the vacuity in the fix's test). Fix (SSOT): migrate both consumers to the correctly-typed apiGetReadyReport (added by SPEC-077 T2), DELETE apiGetReady + stale ReadyRecord[] typing + update their unit/component tests to fixture the REAL ReadyReport shape; add a regression component test that renders ActivePlansPanel with the real object shape (would have thrown pre-fix). AC: (1) ActivePlansPanel + PlanExecution component tests pass against real-shape fixtures; (2) grep confirms zero apiGetReady references remain; (3) affected unit tests (api.test.ts) updated and green.
