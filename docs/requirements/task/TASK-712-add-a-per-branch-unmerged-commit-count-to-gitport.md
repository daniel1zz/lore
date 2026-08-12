---
id: TASK-712
type: task
role: plan
title: "Add a per-branch unmerged-commit count to GitPort and surface it in lore territory, the one fact AC-REPLAY-1 proved unreachable"
status: draft
priority: medium
phase: "replay"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
AC-REPLAY-1 is attested RED (exit_code 1) on task-prove-sufficiency-replay-the-2026-08-11-diagnosis-through. That red is correct and must not be resolved by weakening the AC.

Measured: of the four facts the 2026-08-11 diagnosis required, three are reachable through lore invocations alone - the foreign branch set, the holder session_id per branch, and the liveness verdict per session. The fourth, an EXACT per-branch unmerged-commit count, is reachable through no shipped lore surface. The only git-backed signal in the port is GitPort.isMerged(branch, into) returning a boolean, and lore territory --json does not call even that.

A boolean cannot answer the question the incident turned on. On 2026-08-11 the branch that was misread as an orphan held exactly one unmerged commit; 'is it merged' answers no for both a branch carrying real work and a branch carrying none, and the count is what tells a reader whether anything would be lost.

Scope: add a count-yielding method to the GitPort interface and its real implementation, carry it on TerritoryEntry, and emit it from lore territory --json. Capability and wiring are ONE acceptance unit - a port method that no surface calls leaves AC-REPLAY-1 exactly as red as it is now.
