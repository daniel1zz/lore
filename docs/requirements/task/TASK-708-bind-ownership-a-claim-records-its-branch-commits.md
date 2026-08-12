---
id: TASK-708
type: task
role: plan
title: "Bind ownership: a claim records its branch, commits carry the Lore-Session trailer, and active_sessions reports branches"
status: draft
priority: medium
phase: "binding"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
Implements the spec's L0 write side. TaskClaim gains a branch field, captured from the caller's worktree at claim time. Commits made under a claim carry a 'Lore-Session: <id>' git trailer. active_sessions[].branches is populated instead of the always-empty value measured on 2026-08-11.

Capability and production wiring are ONE acceptance unit: a branch field on the schema proves nothing. The ACs assert the live call sites - lore claim writing it, and the bootstrap payload surfacing it.
