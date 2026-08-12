---
id: TASK-709
type: task
role: plan
title: "Prove sufficiency: replay the 2026-08-11 diagnosis through lore alone and retire the git-topology merge protocol"
status: draft
priority: medium
phase: "replay"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-129
plan: PLAN-129
---
The sufficiency proof for P1.

An integration oracle reconstructs the four facts the 2026-08-11 diagnosis required - foreign branch set, unmerged commit count per branch, holder session_id per branch, liveness verdict per session - using lore invocations only. It asserts a CONCLUSION is reachable, not that a command exists, so it cannot pass against an unwired capability.

The shipped merge protocol changes from 'scan git branch -a unconditionally, treat unmerged commits as orphans' to 'partition with lore territory, act only on mine and unowned'. The old rule is correct for one orchestrator and actively harmful for two: on 2026-08-11 it read a live peer's in-flight branch as an orphan to rescue.

The change MUST land in assets/ (the SSOT that lore setup installs into consumer projects) and the embedded assets manifest MUST be regenerated - a change only to this repo's own files does not exist for consumers.
