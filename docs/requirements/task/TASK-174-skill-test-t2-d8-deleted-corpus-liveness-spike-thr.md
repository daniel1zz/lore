---
id: TASK-174
type: task
role: plan
title: "[Skill:test] T2 D8 deleted-corpus liveness spike (throw-vs-hang empirical pin)"
status: archived
priority: high
phase: "Phase 1: Contracts & spikes"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-166, type: blocks}
---
Estimate: M
Approach: bun test that mounts 2 mkdtemp corpora via createApp, deletes corpus A's lore.db (and -wal/-shm) mid-session, then issues a request/store call against A with a 5s ceiling and a concurrent call against B; record observed behavior (throw class vs hang) in the test file header comment AND as a knowledge note if it forces a watchdog.
Source: spec-078 D8 (Ops demand: empirical pin BEFORE trusting try/catch isolation).
Dimensions: D-FUNC
Scope-Alt: none — this task IS the risk mitigation for the H-risk "hang starves event loop".
Covers: AC-078-3

AC:
- Given 2 mounted corpora, When A's db file is unlinked mid-session, Then a subsequent A-operation settles (resolve or reject) within 5000ms — never hangs past the ceiling.
- Given the same window, When B is queried concurrently, Then B returns success.
- Given the observed behavior, When the test lands, Then the throw-vs-hang conclusion is recorded in the test header and referenced by T8's Approach (watchdog decision input).
