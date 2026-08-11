---
id: TASK-584
type: task
role: plan
title: "T3 cli: config keys + composition wiring + lore trace stats verb + feed/context_bundle instrumentation + startup prune + integration tests"
status: archived
priority: medium
phase: "P3-cli"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-108
plan: PLAN-108
---
LoreConfigSchema: trace.enabled (default true) + trace.retention_days (default 90). Composition root wires TraceRecorder (Turso mode: separate local bun:sqlite handle on replica file, ApiKeyStore precedent; trace_events stays OUT of sync-push table set). New CLI verb 'lore trace stats [--since] [--json] [--raw-queries]' — aggregates only by default (counts-by-kind, deny-by-checkpoint incl. layer disambiguation, zero-hit searches, never-read docs, deny-to-retry gap computed read-side vs audit). Instrument 'lore gate' CLI deny path (layer=hook), feed packs and MCP context_bundle (kind=feed/context_bundle, checkpoint column). Opportunistic bounded-batch retention prune at CLI startup (DELETE WHERE id IN (SELECT ... LIMIT 50000) loop); trace.enabled=false disables recording AND pruning. Covers AC-TRACE-4/5/6.
