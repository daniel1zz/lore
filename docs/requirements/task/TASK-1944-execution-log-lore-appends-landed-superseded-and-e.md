---
id: TASK-1944
type: task
role: plan
title: "Execution log: lore appends landed, superseded and evidence-rebound entries; the intent body stays locked (AC-LND-6)"
status: deprecated
priority: high
phase: "P3 Land, dispatch, log, drift"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-247
plan: PLAN-247
links:
  - {id: TASK-1945, type: blocks}
---
Covers: AC-LND-6
TDD-Role: green
Approach: new execution-log-service.ts is the sole writer of extra.execution_log (append-only; read-merge-write like PlanIntegrationBranchService, so every other extra key stays byte-identical). The key is added to DEDICATED_EXTRA_KEYS so lore set is refused with exit 4. record-lock-service.ts lets a locked task accept appends from this writer only; the body bytes and body version never change. The existing landing recorder (integrate's LandingRecorder, BR-1336) and the evidence re-bind path call appendEntry, so the log is a by-product of the landing, not a separate step. app.ts wires the service in the same task.
Done when: AC-LND-6 passes through the compiled binary; typecheck passes.
