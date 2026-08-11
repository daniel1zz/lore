---
id: TASK-595
type: task
role: plan
title: "T3 actor-identity guard + zero-evidence release advisory (all 3 ACs)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-115
plan: PLAN-115
---
Implement spec-claim-time-actor-identity-guard-zero-evidence-release-advis in full (audit HIGH: 0/3 ACs landed). AC-IDENTITY-REJECT: task-claim gate predicate rejects os_default identity collisions (same by, os_default source, different worktree/machine, same plan) with field gate:task-claim:actor-identity. AC-IDENTITY-ESCAPE: workflow.gates."task-claim".actor_identity.enabled=false disables only this predicate. AC-RELEASE-ADVISORY: lore release on zero-evidence task exits 0 AND emits warning line + warnings[] in --json and MCP lore_release. Read the spec first (lore get spec-claim-time-actor-identity-guard-zero-evidence-release-advis) — it is the SSOT incl. identity_source plumbing and declared test file tests/unit/service/actor-identity-guard.bun.test.ts. Respect SPEC-071 session-actor tier interplay (utils.ts:349) and existing os-fallback advisory (utils.ts:373).
