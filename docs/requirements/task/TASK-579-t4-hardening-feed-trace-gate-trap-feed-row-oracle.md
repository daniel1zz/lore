---
id: TASK-579
type: task
role: plan
title: "T4 hardening: feed-trace gate trap, feed-row oracle, deny-gap complexity, prune completion, AC-TRACE-7 real wiring"
status: archived
priority: medium
phase: "P4-hardening"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-108
plan: PLAN-108
---
Five findings from the diff-backed SPEC-102 assessment (knowledge-assessment-implementation-trace-layer-spec-102-2026-3). (1) feed.ts gates the feed-trace write on process.exitCode === 0 — all three CURRENT handlers assign 0 explicitly so no live bug, but Node's success default is undefined, so any future handler written the natural way silently drops its trace: change the predicate to treat unset as success ((process.exitCode ?? 0) === 0) and state the invariant in a comment. (2) NO oracle asserts a kind='feed' row ever lands — add one to trace-stats.bun.test.ts (run a successful lore feed, assert the row with its checkpoint column). (3) trace-stats deny_retry_gap runs auditEntries.some() inside a per-deny loop with an epoch --since default: pre-group audit entries by (checkpoint, actor) into a Map once, O(n+m) instead of O(denies x audit history). (4) the startup prune is fired without await while commands close the App in a finally block — an in-flight batch can hit a closed handle; track the promise and await it on the close path, keeping the command non-blocking otherwise. (5) AC-TRACE-7's happy path is a mirror (separate handle on a replica-shaped file) rather than the real createApp Turso branch: @libsql/client accepts file: URLs, so construct the REAL Turso composition (config sync.enabled + file: remote_url + LORE_SYNC_TOKEN) and assert trace rows land on the local handle while trace_events stays out of the sync-push replicated set.
