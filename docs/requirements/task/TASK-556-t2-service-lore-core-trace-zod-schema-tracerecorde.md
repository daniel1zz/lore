---
id: TASK-556
type: task
role: plan
title: "T2 service: @lore/core trace Zod schema + TraceRecorder port + CorpusService/GateEnforcer instrumentation + vitest"
status: archived
priority: medium
phase: "P2-service"
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: PLAN-108
plan: PLAN-108
links:
  - {id: TASK-584, type: blocks}
---
TraceEvent Zod schema in @lore/core (browser-safe barrel — NO Node builtins). TraceRecorder as optional DI port mirroring recordGateSkip (bare constructions untraced; swallow-and-continue on write failure; validates kind/surface via Zod at the recorder seam). Instrument CorpusService.get (kind=get, doc_id) and CorpusService.search (kind=search, hit_count, details.query) and GateEnforcer deny path (kind=gate_deny, checkpoint, details.predicates_failed/target_slug/layer=service). Stats reads must never emit trace rows (no recursion). Covers AC-TRACE-2, AC-TRACE-3.
