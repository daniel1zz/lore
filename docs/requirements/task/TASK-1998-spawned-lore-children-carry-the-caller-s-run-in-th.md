---
id: TASK-1998
type: task
role: plan
title: "Spawned lore children carry the caller's run in their environment"
status: approved
priority: critical
phase: "P3 Callers"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-1997, type: blocks}
---
Covers: AC-RV-11
Approach: the review batch (review-batch-wiring.ts:66), the human channel (real-human-channel-port.ts:107) and integrate's migrate child (integrate-service.ts:912) pass the caller's run as env { ...opts.env, [HARNESS_RUN_ENV]: run } instead of appending --harness-run (literal at review-batch-wiring.ts is AC-RV-11's falsifier); the child descends from the caller, so it verifies. human-channel.ts:208 detects agent ancestry from the env value. commands/session.ts:217's message names the per-call value. Adapters read env from the invocation, never process.env (cli module invariant).
Branching: part of the P2+P3 chain on the plan's integration branch; branches from the tool-server task.
