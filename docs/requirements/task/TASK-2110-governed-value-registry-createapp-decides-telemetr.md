---
id: TASK-2110
type: task
role: plan
title: "Governed-value registry; createApp decides telemetry through it"
status: draft
priority: medium
phase: "P2 Registry and binding"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
links:
  - {id: TASK-2064, type: blocks}
---
Covers: AC-CV-2
Approach: GOVERNED_VALUES entries { id, describe, read(config) }, pure and browser-safe; initial entries: telemetry.recording, telemetry.file, trace.enabled, trace.retention_days (through resolveTraceRetentionDays/resolveTraceEnabled), plus every entry the P5 mapping needs (added there). app.ts calls the literal 'GOVERNED_VALUES["telemetry.recording"].read(config)' at the telemetry decision (falsifier). Build packages/core before verifying dependents.
