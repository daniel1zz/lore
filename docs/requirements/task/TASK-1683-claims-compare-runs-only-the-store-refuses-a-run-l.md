---
id: TASK-1683
type: task
role: plan
title: "Claims compare runs only; the store refuses a run-less claim; legacy claims expire in the schema upgrade; fallback code deleted"
status: archived
priority: high
phase: "P1"
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PLAN-221
plan: PLAN-221
links:
  - {id: TASK-1641, type: blocks}
  - {id: TASK-1635, type: blocks}
---
Implements end state item 4 of spec-every-write-is-made-by-a-known-party-an-attested-agent-run (BR-1040, BR-1043, BR-1056, BR-130, BR-1352; retires BR-1042, BR-131, BR-134, BR-1163): run-only claim comparison everywhere (claim, release, done holder, overlap, phase claims); store refuses claim/refresh/release without a run; schema upgrade expires pre-run claims once; actor_identity removed from the strict config schema and `lore migrate config-keys` removes it from a project config; delete actorIdentityGuard, ACTOR_IDENTITY_COLLISION, os-fallback, detectWorktreeDerivedActor, the OS-username warning. Blocked by the T1 task (resolver).
